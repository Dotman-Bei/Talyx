import { useState } from 'react';

// One transaction at a time per control: what it is doing now, how it ended, and the hash it left.

export interface ActionState { busy?: string; error?: string; done?: { text: string; tx?: string; chain?: 'sepolia' | 'v3' } }

export function useAction() {
  const [state, setState] = useState<ActionState>({});
  async function run(start: string, fn: (step: (s: string) => void) => Promise<ActionState['done'] | void>) {
    setState({ busy: start });
    try {
      const done = await fn((s) => setState({ busy: s }));
      setState({ done: done ?? undefined });
    } catch (e) {
      const { errorText } = await import('./chain');
      setState({ error: errorText(e) });
    }
  }
  return { ...state, run, reset: () => setState({}) };
}
