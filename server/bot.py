#
# NL-IT Voice Translator
# Push-to-talk real-time translation between Dutch and Italian
#

import os

from dotenv import load_dotenv
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    InterruptionFrame,
    StartFrame,
    UserStartedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi import RTVIClientMessageFrame
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.transports.daily.transport import DailyParams

load_dotenv(override=True)

# Translation mode: "nl-to-it" or "it-to-nl"
# Can be changed via client message
DEFAULT_MODE = "nl-to-it"

# Cartesia voice IDs
VOICES = {
    "italian": "d718e944-b313-4998-b011-d1cc078d4ef3",  # Liv - Casual Friend (Italian female)
    "dutch": "96355f3d-0179-4c9a-a8d8-11ef0779a9b8",    # Noa - Reassuring Responder (Dutch female)
}

# System prompts for translation
TRANSLATION_PROMPTS = {
    "nl-to-it": """You are a Dutch to Italian translator. 
The user will speak in Dutch. Your ONLY task is to translate their speech to Italian.
Do NOT add explanations, commentary, or engage in conversation.
Just output the Italian translation of what they said.
Keep the same tone and style as the original.""",
    
    "it-to-nl": """You are an Italian to Dutch translator.
The user will speak in Italian. Your ONLY task is to translate their speech to Dutch.
Do NOT add explanations, commentary, or engage in conversation.
Just output the Dutch translation of what they said.
Keep the same tone and style as the original.""",
}

transport_params = {
    "daily": lambda: DailyParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
    ),
    "webrtc": lambda: TransportParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
    ),
}


class PushToTalkGate(FrameProcessor):
    """Gates audio input based on push-to-talk button state."""
    
    def __init__(self):
        super().__init__()
        self._gate_opened = False
        self._translation_mode = DEFAULT_MODE

    @property
    def translation_mode(self):
        return self._translation_mode

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            await self.push_frame(frame, direction)

        elif isinstance(frame, RTVIClientMessageFrame):
            self._handle_rtvi_frame(frame)
            await self.push_frame(frame, direction)

        # If the gate is closed, suppress audio frames
        elif not self._gate_opened and isinstance(
            frame,
            (
                InputAudioRawFrame,
                UserStartedSpeakingFrame,
                InterruptionFrame,
            ),
        ):
            logger.trace(f"{frame.__class__.__name__} suppressed - Button not pressed")
        else:
            await self.push_frame(frame, direction)

    def _handle_rtvi_frame(self, frame: RTVIClientMessageFrame):
        if frame.type == "push_to_talk" and frame.data:
            data = frame.data
            if data.get("state") == "start":
                self._gate_opened = True
                logger.info("🎤 Recording started")
            elif data.get("state") == "stop":
                self._gate_opened = False
                logger.info("🎤 Recording stopped - translating...")
        
        # Handle mode switch
        elif frame.type == "set_mode" and frame.data:
            new_mode = frame.data.get("mode")
            if new_mode in TRANSLATION_PROMPTS:
                self._translation_mode = new_mode
                logger.info(f"🔄 Translation mode changed to: {new_mode}")


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    logger.info("Starting NL-IT Translator bot")

    # Speech-to-text (supports both Dutch and Italian)
    stt = DeepgramSTTService(
        api_key=os.getenv("DEEPGRAM_API_KEY"),
        settings=DeepgramSTTService.Settings(
            language="multi",  # Auto-detect language
        ),
    )

    push_to_talk_gate = PushToTalkGate()

    # Text-to-speech - Italian voice (will be switched based on mode)
    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        settings=CartesiaTTSService.Settings(
            voice=VOICES["italian"],
        ),
    )

    # Translation LLM
    llm = OpenAILLMService(
        api_key=os.getenv("OPENAI_API_KEY"),
        settings=OpenAILLMService.Settings(
            system_instruction=TRANSLATION_PROMPTS[DEFAULT_MODE],
        ),
    )

    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            push_to_talk_gate,
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )

    @task.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        logger.info("Client ready")

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)
    await runner.run(task)


async def bot(runner_args: RunnerArguments):
    """Main bot entry point."""
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main
    main()
