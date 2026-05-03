import React, { useState } from 'react';

interface YamlModalProps {
  yaml: string;
  fileName: string;
  onClose: () => void;
}

export default function YamlModal({ yaml, fileName, onClose }: YamlModalProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(yaml).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="yaml-modal-backdrop"
      onMouseDown={onClose}
    >
      <div
        className="yaml-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="yaml-modal__header">
          <span className="yaml-modal__title">📄 {fileName} — Export</span>
          <button
            className={`yaml-modal__copy${copied ? ' yaml-modal__copy--done' : ''}`}
            onClick={copy}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button className="yaml-modal__close" onClick={onClose}>×</button>
        </div>
        <pre className="yaml-modal__body">{yaml}</pre>
      </div>
    </div>
  );
}
