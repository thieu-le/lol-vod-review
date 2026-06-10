import type { RendererApi } from '@shared/ipc-contract';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare global {
  interface Window {
    api: RendererApi;
  }

  // Electron's <webview> tag. Typed loosely — we only set a handful of string
  // attributes and attach DOM events imperatively via a ref.
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: boolean;
          webpreferences?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
