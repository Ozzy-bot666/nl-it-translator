#
# Dutch-Italian Real-time Translation Bot
# Based on pipecat-ai/pipecat-examples/daily-multi-translation
#
# Translates speech bidirectionally between Dutch and Italian
#

import os

from dotenv import load_dotenv
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.observers.loggers.transcription_log_observer import TranscriptionLogObserver
from pipecat.pipeline.parallel_pipeline import ParallelPipeline
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.runner.types import RunnerArguments
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.base_transport import BaseTransport
from pipecat.transports.daily.transport import DailyParams, DailyTransport

load_dotenv(override=True)

# Background sound disabled for cleaner output
# BACKGROUND_SOUND_FILE = "office-ambience-mono-16000.mp3"

# Default Cartesia voice IDs (can be overridden via env vars)
# These are example IDs - replace with actual Dutch/Italian voices
DEFAULT_DUTCH_VOICE = os.getenv("DUTCH_VOICE_ID", "79a125e8-cd45-4c13-8a67-188112f4dd22")  # Placeholder
DEFAULT_ITALIAN_VOICE = os.getenv("ITALIAN_VOICE_ID", "a0e99841-438c-4a64-b679-ae501e7d6091")  # Placeholder


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    logger.info("Starting Dutch-Italian translation bot")

    # Speech-to-text with multilingual support
    stt = DeepgramSTTService(
        api_key=os.getenv("DEEPGRAM_API_KEY"),
        settings=DeepgramSTTService.Settings(
            language="multi",  # Auto-detect Dutch or Italian
        ),
    )

    # TTS for Dutch output (for Italian speakers)
    tts_dutch = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        settings=CartesiaTTSService.Settings(
            voice=DEFAULT_DUTCH_VOICE,
            language="nl",  # Dutch
        ),
        transport_destination="dutch",
    )
    
    # TTS for Italian output (for Dutch speakers)
    tts_italian = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        settings=CartesiaTTSService.Settings(
            voice=DEFAULT_ITALIAN_VOICE,
            language="it",  # Italian
        ),
        transport_destination="italian",
    )

    # LLM for translating to Dutch
    llm_to_dutch = OpenAILLMService(
        api_key=os.getenv("OPENAI_API_KEY"),
        settings=OpenAILLMService.Settings(
            system_instruction="""You are a real-time translator. 
You will receive text that may be in Italian or Dutch.
- If the input is in Italian, translate it to Dutch.
- If the input is already in Dutch, output nothing (empty response).
- Only output the translation, nothing else. No explanations, no quotes.
- Preserve the tone and intent of the original."""
        ),
    )
    
    # LLM for translating to Italian
    llm_to_italian = OpenAILLMService(
        api_key=os.getenv("OPENAI_API_KEY"),
        settings=OpenAILLMService.Settings(
            system_instruction="""You are a real-time translator.
You will receive text that may be in Dutch or Italian.
- If the input is in Dutch, translate it to Italian.
- If the input is already in Italian, output nothing (empty response).
- Only output the translation, nothing else. No explanations, no quotes.
- Preserve the tone and intent of the original."""
        ),
    )

    vad_processor = VADProcessor(vad_analyzer=SileroVADAnalyzer())

    # Context aggregators for each translation direction
    context_dutch = LLMContext()
    context_aggregator_dutch = LLMContextAggregatorPair(context_dutch)

    context_italian = LLMContext()
    context_aggregator_italian = LLMContextAggregatorPair(context_italian)

    pipeline = Pipeline(
        [
            transport.input(),  # Transport user input
            vad_processor,
            stt,
            ParallelPipeline(
                # Dutch output pipeline (for Italian speakers)
                [
                    context_aggregator_dutch.user(),
                    llm_to_dutch,
                    tts_dutch,
                    context_aggregator_dutch.assistant(),
                ],
                # Italian output pipeline (for Dutch speakers)
                [
                    context_aggregator_italian.user(),
                    llm_to_italian,
                    tts_italian,
                    context_aggregator_italian.assistant(),
                ],
            ),
            transport.output(),  # Transport bot output
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,
            audio_out_sample_rate=16000,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        observers=[TranscriptionLogObserver()],
    )

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)

    await runner.run(task)


async def bot(runner_args: RunnerArguments):
    """Main bot entry point compatible with Pipecat Cloud."""
    transport = DailyTransport(
        runner_args.room_url,
        runner_args.token,
        "NL-IT Translator",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_out_destinations=["dutch", "italian"],
            microphone_out_enabled=False,  # Disable since we just use custom tracks
        ),
    )

    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
