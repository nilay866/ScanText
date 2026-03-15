'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Zap, Shield, Sparkles } from 'lucide-react';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export default function UploadPage() {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFile = useCallback(
    (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        alert('Please upload a PNG, JPG, or WEBP image.');
        return;
      }
      if (file.size > MAX_SIZE) {
        alert('File is too large. Maximum size is 10MB.');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // Store in sessionStorage so editor page can access it
        sessionStorage.setItem('scantext_image', dataUrl);
        router.push('/editor');
      };
      reader.readAsDataURL(file);
    },
    [router]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="upload-page">
      <header className="upload-header">
        <div className="upload-logo">
          <div className="upload-logo-icon">
            <Sparkles size={24} color="white" />
          </div>
          <h1>ScanText</h1>
        </div>
        <p>
          Upload a screenshot and edit any text while preserving the original
          visual appearance. Like the screenshot itself became editable.
        </p>
      </header>

      <div
        className={`upload-zone ${isDragging ? 'dragging' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onClick}
        id="upload-zone"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          onChange={onFileChange}
          style={{ display: 'none' }}
          id="file-input"
        />
        <div className="upload-icon">
          <Upload size={32} />
        </div>
        <h3>Drop your screenshot here</h3>
        <p>or click to browse files</p>
        <div className="upload-formats">
          <span className="format-badge">PNG</span>
          <span className="format-badge">JPG</span>
          <span className="format-badge">WEBP</span>
        </div>
      </div>

      <div className="upload-features">
        <div className="feature-item">
          <Zap size={18} />
          <span>Instant OCR detection</span>
        </div>
        <div className="feature-item">
          <Shield size={18} />
          <span>100% client-side</span>
        </div>
        <div className="feature-item">
          <Sparkles size={18} />
          <span>Style-preserving edits</span>
        </div>
      </div>
    </div>
  );
}
