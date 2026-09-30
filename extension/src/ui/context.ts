import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { IrisApp } from '../core/app';

export const AppContext = createContext<IrisApp | null>(null);

export function useApp(): IrisApp {
  const app = useContext(AppContext);
  if (!app) throw new Error('Iris components must be rendered inside <AppContext.Provider>');
  return app;
}
