// Minimal JSX typing for Electron's <webview> tag so TSX compiles
declare namespace JSX {
    interface IntrinsicElements {
        webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
            src?: string
            partition?: string
            allowpopups?: boolean
        }
    }
}


