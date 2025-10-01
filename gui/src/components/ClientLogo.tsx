import React from 'react';

interface ClientLogoProps {
    name: string;
    size?: number;
}

function normalizeClientKey(rawName: string): 'vscode' | 'cursor' | 'claude-desktop' | 'claude-code' | 'generic' {
    const n = (rawName || '').toLowerCase();
    if (n.includes('visual studio code') || n.includes('vs code') || n.includes('vscode')) return 'vscode';
    if (n.includes('cursor')) return 'cursor';
    if (n.includes('claude') && n.includes('desktop')) return 'claude-desktop';
    if (n.includes('claude') && n.includes('code')) return 'claude-code';
    return 'generic';
}

function getBrand(name: string): { bg: string; text: string; label: string } {
    switch (normalizeClientKey(name)) {
        case 'vscode':
            return { bg: '#007ACC', text: '#FFFFFF', label: 'VS' };
        case 'cursor':
            return { bg: '#6A4DF5', text: '#FFFFFF', label: 'C' };
        case 'claude-desktop':
            return { bg: '#F59E0B', text: '#1F2937', label: 'CD' };
        case 'claude-code':
            return { bg: '#7F56D9', text: '#FFFFFF', label: 'CC' };
        default:
            return { bg: '#9CA3AF', text: '#FFFFFF', label: '?' };
    }
}

function getLogoUrl(name: string): string | null {
    const key = normalizeClientKey(name);
    switch (key) {
        case 'vscode':
            // Wikimedia Commons stable file path
            return 'https://commons.wikimedia.org/wiki/Special:FilePath/Visual_Studio_Code_1.35_icon.svg';
        case 'cursor':
            return 'https://cursor.com/assets/images/logo.svg';
        case 'claude-desktop':
        case 'claude-code':
            // Use Claude AI logo for both Desktop and Code variants unless specific assets are provided
            return 'https://commons.wikimedia.org/wiki/Special:FilePath/Claude_AI_logo.svg';
        default:
            return null;
    }
}

const ClientLogo: React.FC<ClientLogoProps> = ({ name, size = 28 }) => {
    const [imgError, setImgError] = React.useState(false);
    const brand = getBrand(name);
    const src = getLogoUrl(name);

    const containerStyle: React.CSSProperties = {
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '6px',
        background: imgError ? brand.bg : 'transparent',
        color: brand.text,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        overflow: 'hidden'
    };

    const labelStyle: React.CSSProperties = {
        fontWeight: 700,
        fontSize: `${Math.max(10, Math.floor(size * 0.45))}px`,
        lineHeight: 1
    };

    return (
        <div aria-hidden title={name} style={containerStyle}>
            {!imgError && src ? (
                <img
                    src={src}
                    alt=""
                    width={size}
                    height={size}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                    onError={() => setImgError(true)}
                />
            ) : (
                <span style={labelStyle}>{brand.label}</span>
            )}
        </div>
    );
};

export default ClientLogo;


