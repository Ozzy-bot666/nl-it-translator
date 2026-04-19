import {
  Button,
  ConnectButton,
  ControlBar,
  ErrorCard,
  TranscriptOverlay,
  UserAudioControl,
  usePipecatConnectionState,
} from '@pipecat-ai/voice-ui-kit';
import { PlasmaVisualizer } from '@pipecat-ai/voice-ui-kit/webgl';
import { LogOutIcon, MicIcon, Languages } from 'lucide-react';
import { usePipecatClient } from '@pipecat-ai/client-react';
import { useCallback, useState } from 'react';

export interface AppProps {
  handleConnect?: () => void | Promise<void>;
  handleDisconnect?: () => void | Promise<void>;
  error?: string | null;
}

export type PushToTalkState = 'idle' | 'talking';
export type TranslationMode = 'nl-to-it' | 'it-to-nl';

const ModeSelector = ({ mode, onModeChange }: { mode: TranslationMode; onModeChange: (mode: TranslationMode) => void }) => {
  return (
    <div className="flex gap-2 items-center bg-background/80 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg">
      <Languages size={20} className="text-muted-foreground" />
      <button
        onClick={() => onModeChange('nl-to-it')}
        className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
          mode === 'nl-to-it'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        🇳🇱 → 🇮🇹
      </button>
      <button
        onClick={() => onModeChange('it-to-nl')}
        className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
          mode === 'it-to-nl'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        🇮🇹 → 🇳🇱
      </button>
    </div>
  );
};

const PushToTalkButton = () => {
  const client = usePipecatClient();
  const [pushToTalkState, setPushToTalkState] = useState<PushToTalkState>('idle');

  const handlePushToTalk = useCallback(() => {
    if (!client || client.state !== 'ready') {
      return;
    }

    if (pushToTalkState === 'idle') {
      setPushToTalkState('talking');
      client.sendClientMessage('push_to_talk', { state: 'start' });
    } else {
      setPushToTalkState('idle');
      client.sendClientMessage('push_to_talk', { state: 'stop' });
    }
  }, [client, pushToTalkState]);

  const isReady = client && client.state === 'ready';

  return (
    <Button
      size="xl"
      variant={pushToTalkState === 'talking' ? 'destructive' : 'primary'}
      disabled={!isReady}
      onMouseDown={handlePushToTalk}
      onMouseUp={handlePushToTalk}
      onTouchStart={handlePushToTalk}
      onTouchEnd={handlePushToTalk}
      className={`transition-all duration-200 select-none ${
        pushToTalkState === 'talking' ? 'scale-105' : ''
      } flex items-center gap-2`}
    >
      <MicIcon size={20} />
      {pushToTalkState === 'talking' ? 'Loslaten om te vertalen' : 'Houd ingedrukt om te spreken'}
    </Button>
  );
};

export const App = ({ handleConnect, handleDisconnect, error }: AppProps) => {
  const { isConnected } = usePipecatConnectionState();
  const client = usePipecatClient();
  const [mode, setMode] = useState<TranslationMode>('nl-to-it');

  const handleModeChange = useCallback((newMode: TranslationMode) => {
    setMode(newMode);
    if (client && client.state === 'ready') {
      client.sendClientMessage('set_mode', { mode: newMode });
    }
  }, [client]);

  if (error) {
    return (
      <ErrorCard error={error} title="Verbindingsfout" />
    );
  }

  return (
    <div className="w-full h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="flex flex-col h-full">
        {/* Header */}
        <header className="p-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            🇳🇱 ↔ 🇮🇹 Vertaler
          </h1>
          {isConnected && (
            <ModeSelector mode={mode} onModeChange={handleModeChange} />
          )}
        </header>

        {/* Main content */}
        <div className="relative overflow-hidden flex-1">
          <main className="flex flex-col gap-0 h-full relative justify-end items-center">
            <PlasmaVisualizer />
            
            {/* Connect button */}
            <div className="absolute w-full h-full flex items-center justify-center">
              <ConnectButton
                size="xl"
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
              />
            </div>

            {/* Transcript overlay */}
            <div className="absolute w-full h-full flex items-center justify-center pointer-events-none">
              <TranscriptOverlay participant="remote" className="max-w-md" />
            </div>

            {/* Controls when connected */}
            {isConnected && (
              <>
                <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 z-20">
                  <PushToTalkButton />
                </div>
                <ControlBar>
                  <UserAudioControl />
                  <Button
                    size="xl"
                    isIcon={true}
                    variant="outline"
                    onClick={handleDisconnect}
                  >
                    <LogOutIcon />
                  </Button>
                </ControlBar>
              </>
            )}
          </main>
        </div>

        {/* Footer */}
        <footer className="p-4 text-center">
          <p className="text-sm text-muted-foreground">
            {mode === 'nl-to-it' 
              ? 'Spreek Nederlands → Hoor Italiaans' 
              : 'Parla italiano → Ascolta olandese'}
          </p>
        </footer>
      </div>
    </div>
  );
};

export default App;
