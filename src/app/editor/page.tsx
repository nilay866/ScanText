'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ArrowLeft,
  Check,
  Type,
  Move,
  Undo,
  Redo,
  ChevronDown,
} from 'lucide-react';
import { TextRegion } from '@/lib/types';
import { runOCR, OCRProgress } from '@/lib/ocr';
import { inpaintRegion, renderText, imageToCanvas } from '@/lib/inpainting';

export default function EditorPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [regions, setRegions] = useState<TextRegion[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isResizing, setIsResizing] = useState<'left' | 'right' | null>(null);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [mode, setMode] = useState<'select' | 'pan'>('select');

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<OCRProgress>({ status: '', progress: 0 });

  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Pristine canvas — cloned once from the original image, NEVER modified
  const pristineCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Working canvas for inpainting operations (cloned from pristine on every apply)
  const workingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ----- Refs to avoid stale closures -----
  const regionsRef = useRef<TextRegion[]>([]);
  regionsRef.current = regions;

  const editingRegionIdRef = useRef<string | null>(null);
  editingRegionIdRef.current = editingRegionId;

  const editTextRef = useRef('');
  editTextRef.current = editText;

  const selectedRegionIdRef = useRef<string | null>(null);
  selectedRegionIdRef.current = selectedRegionId;

  const imageRef = useRef<HTMLImageElement | null>(null);
  imageRef.current = image;

  const scaleRef = useRef(1);
  scaleRef.current = scale;

  const offsetRef = useRef({ x: 0, y: 0 });
  offsetRef.current = offset;

  const modeRef = useRef<'select' | 'pan'>('select');
  modeRef.current = mode;

  const showNotification = useCallback((msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  }, []);

  // Load image from sessionStorage
  useEffect(() => {
    const dataUrl = sessionStorage.getItem('scantext_image');
    if (!dataUrl) {
      router.push('/');
      return;
    }
    const img = new Image();
    img.onload = () => {
      setImage(img);
      if (containerRef.current) {
        const containerW = containerRef.current.clientWidth;
        const containerH = containerRef.current.clientHeight;
        const fitScale = Math.min(
          (containerW - 80) / img.naturalWidth,
          (containerH - 80) / img.naturalHeight,
          1
        );
        setScale(fitScale);
        setOffset({
          x: (containerW - img.naturalWidth * fitScale) / 2,
          y: (containerH - img.naturalHeight * fitScale) / 2,
        });
      }
    };
    img.src = dataUrl;
  }, [router]);

  // Run OCR once image loads
  useEffect(() => {
    if (!image) return;
    setIsProcessing(true);
    // Build the pristine canvas once from the original image — never touched again
    pristineCanvasRef.current = imageToCanvas(image);
    runOCR(image, setProgress)
      .then((detected) => {
        setRegions(detected);
        setIsProcessing(false);
        // Working canvas starts as a clone of the pristine original
        const p = pristineCanvasRef.current;
        if (p) {
          const w = document.createElement('canvas');
          w.width = p.width;
          w.height = p.height;
          w.getContext('2d')!.drawImage(p, 0, 0);
          workingCanvasRef.current = w;
        }
        showNotification(`Detected ${detected.length} text regions`);
      })
      .catch((err) => {
        console.error('OCR failed:', err);
        setIsProcessing(false);
        showNotification('OCR processing failed. Please try again.');
      });
  }, [image, showNotification]);

  // ----- History (Undo / Redo) -----
  const [history, setHistory] = useState<TextRegion[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // When initial regions load, save as first history state
  useEffect(() => {
    if (regions.length > 0 && history.length === 0 && !isProcessing) {
      setHistory([regions]);
      setHistoryIndex(0);
    }
  }, [regions, history.length, isProcessing]);

  // Clone the pristine canvas — gives us a fresh unmodified copy each time
  const clonePristine = useCallback((): HTMLCanvasElement => {
    const src = pristineCanvasRef.current;
    if (!src) {
      // Fallback: build from image if pristine not yet ready
      const img = imageRef.current;
      if (img) return imageToCanvas(img);
      return document.createElement('canvas');
    }
    const dest = document.createElement('canvas');
    dest.width = src.width;
    dest.height = src.height;
    dest.getContext('2d')!.drawImage(src, 0, 0);
    return dest;
  }, []);

  // Apply a specific state from history
  const applyHistoryState = useCallback((newRegions: TextRegion[]) => {
    setRegions(newRegions);
    // Always start from the PRISTINE original — never the working canvas
    const freshCanvas = clonePristine();
    newRegions.forEach((r) => {
      if (r.editedText !== r.text) {
        inpaintRegion(freshCanvas, r.x, r.y, r.width, r.height, r.backgroundColor);
        if (r.editedText.trim().length > 0) {
          renderText(
            freshCanvas,
            r.editedText,
            r.x, r.y, r.width, r.height,
            r.fontSize, r.fontWeight, r.fontFamily,
            r.color, r.alignment
          );
        }
      }
    });
    workingCanvasRef.current = freshCanvas;
  }, [clonePristine]);

  const handleUndo = useCallback(() => {
    setHistoryIndex((prevIndex) => {
      if (prevIndex > 0) {
        const newIndex = prevIndex - 1;
        applyHistoryState(history[newIndex]);
        return newIndex;
      }
      return prevIndex;
    });
    setEditingRegionId(null);
  }, [history, applyHistoryState]);

  const handleRedo = useCallback(() => {
    setHistoryIndex((prevIndex) => {
      if (prevIndex < history.length - 1) {
        const newIndex = prevIndex + 1;
        applyHistoryState(history[newIndex]);
        return newIndex;
      }
      return prevIndex;
    });
    setEditingRegionId(null);
  }, [history, applyHistoryState]);

  // Global hotkeys for Undo/Redo
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleUndo, handleRedo]);


  // ----- Commit edit (uses refs → never stale) -----
  const commitEdit = useCallback(() => {
    const currentEditingId = editingRegionIdRef.current;
    const currentEditText = editTextRef.current;

    if (!currentEditingId) return;

    setRegions((prev) => {
      const updated = prev.map((r) => {
        if (r.id !== currentEditingId) return r;
        const newText = currentEditText;
        return { ...r, editedText: newText };
      });

      // Avoid pushing to history if text hasn't changed
      const original = prev.find(r => r.id === currentEditingId);
      if (original && original.editedText !== currentEditText) {
        setHistory((prevHistory) => {
          // Discard future history if we are branched off an undo
          const newHistory = prevHistory.slice(0, historyIndex + 1);
          return [...newHistory, updated];
        });
        setHistoryIndex((i) => i + 1);
      }

      applyHistoryState(updated);
      return updated;
    });

    setEditingRegionId(null);
  }, [historyIndex, applyHistoryState]);

  // ----- Update selected region properties live -----
  const updateSelectedRegion = useCallback((updates: Partial<TextRegion>) => {
    const currentSelectedId = selectedRegionIdRef.current;
    if (!currentSelectedId) return;

    setRegions((prev) => {
      const updated = prev.map((r) => {
        if (r.id !== currentSelectedId) return r;
        return { ...r, ...updates };
      });
      applyHistoryState(updated);
      return updated;
    });
  }, [applyHistoryState]);

  const commitPropertyEdit = useCallback(() => {
    setHistory((prevHistory) => {
      const newHistory = prevHistory.slice(0, historyIndex + 1);
      return [...newHistory, regionsRef.current];
    });
    setHistoryIndex((i) => i + 1);
  }, [historyIndex]);

  // ----- Draw canvas -----
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !image) return;

    const container = containerRef.current;
    if (!container) return;

    const dpr = window.devicePixelRatio || 1;
    // Set actual size in memory (scaled to account for extra pixel density)
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    
    // Normalize coordinate system to use css pixels
    ctx.scale(dpr, dpr);

    // Clear any previous CSS transforms that might have been added
    canvas.style.transform = 'none';

    ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);

    // Draw the working canvas (with inpainted regions) or original image
    if (workingCanvasRef.current) {
      ctx.drawImage(workingCanvasRef.current, 0, 0);
    } else {
      ctx.drawImage(image, 0, 0);
    }

    // --- Anti-Screenshot Watermark Overlay ---
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = 'bold 32px sans-serif'; 
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'; // Translucent white
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';     // Dark outline for visibility on all backgrounds
    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Rotate canvas for diagonal watermark
    ctx.rotate(-Math.PI / 6); // -30 degrees
    
    // Calculate bounds to fill the rotated canvas area
    const diagonal = Math.sqrt(image.width * image.width + image.height * image.height);
    const stepX = 500;
    const stepY = 150;
    
    for (let x = -diagonal; x < diagonal * 2; x += stepX) {
      for (let y = -diagonal; y < diagonal * 2; y += stepY) {
        const text = 'ScanText Preview · Pay ₹1 to Export';
        ctx.fillText(text, x, y);
        ctx.strokeText(text, x, y);
      }
    }
    ctx.restore();
    // ------------------------------------------

    // Draw bounding boxes
    regions.forEach((region) => {
      const isSelected = region.id === selectedRegionId;
      const isEditing = region.id === editingRegionId;

      if (isEditing) return;

      ctx.save();
      if (isSelected) {
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
        ctx.lineWidth = 2 / scale; // Screen-absolute line width
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.08)';
        ctx.fillRect(region.x, region.y, region.width, region.height);

        // Draw resize handles if not actively typing
        if (!isEditing) {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#6366f1';
          ctx.lineWidth = 1.5 / scale;
          const handleSize = 8 / scale;
          
          // Left handle
          ctx.fillRect(region.x - handleSize/2, region.y + region.height/2 - handleSize/2, handleSize, handleSize);
          ctx.strokeRect(region.x - handleSize/2, region.y + region.height/2 - handleSize/2, handleSize, handleSize);
          
          // Right handle
          ctx.fillRect(region.x + region.width - handleSize/2, region.y + region.height/2 - handleSize/2, handleSize, handleSize);
          ctx.strokeRect(region.x + region.width - handleSize/2, region.y + region.height/2 - handleSize/2, handleSize, handleSize);
        }
      } else {
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.35)';
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([4 / scale, 4 / scale]);
      }
      ctx.strokeRect(region.x, region.y, region.width, region.height);
      ctx.restore();
    });

    ctx.restore();
  }, [image, regions, selectedRegionId, editingRegionId, scale, offset]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  useEffect(() => {
    const handleResize = () => drawCanvas();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [drawCanvas]);

  // ----- Coordinate conversion -----
  const screenToImage = useCallback(
    (screenX: number, screenY: number) => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      return {
        x: (screenX - rect.left - offsetRef.current.x) / scaleRef.current,
        y: (screenY - rect.top - offsetRef.current.y) / scaleRef.current,
      };
    },
    []
  );

  const findRegionAt = useCallback(
    (imgX: number, imgY: number): TextRegion | null => {
      const currentRegions = regionsRef.current;
      for (let i = currentRegions.length - 1; i >= 0; i--) {
        const r = currentRegions[i];
        if (imgX >= r.x && imgX <= r.x + r.width && imgY >= r.y && imgY <= r.y + r.height) {
          return r;
        }
      }
      return null;
    },
    []
  );

  // ----- Mouse interaction -----
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // If in pan mode or middle mouse button, start panning
      if (modeRef.current === 'pan' || e.button === 1) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y });
        return;
      }

      const { x, y } = screenToImage(e.clientX, e.clientY);

      // 1. Check if clicking on resize handles of the selected region
      if (selectedRegionIdRef.current && editingRegionIdRef.current === null) {
        const sr = regionsRef.current.find(r => r.id === selectedRegionIdRef.current);
        if (sr) {
          const handleSize = 12 / scaleRef.current; // generous hit area
          // Left handle
          if (Math.abs(x - sr.x) <= handleSize && Math.abs(y - (sr.y + sr.height/2)) <= handleSize) {
            setIsResizing('left');
            return;
          }
          // Right handle
          if (Math.abs(x - (sr.x + sr.width)) <= handleSize && Math.abs(y - (sr.y + sr.height/2)) <= handleSize) {
            setIsResizing('right');
            return;
          }
        }
      }
      const region = findRegionAt(x, y);

      if (!region) {
        // Clicked empty space — commit any active edit, deselect, start panning
        commitEdit();
        setSelectedRegionId(null);
        setEditingRegionId(null);
        setIsPanning(true);
        setPanStart({ x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y });
        return;
      }

      // Clicked a region
      const wasSelected = selectedRegionIdRef.current === region.id;
      const wasEditing = editingRegionIdRef.current !== null;

      if (wasEditing && editingRegionIdRef.current !== region.id) {
        // Was editing a different region — commit that edit first
        commitEdit();
      }

      if (wasSelected) {
        // Second click on same region → enter edit mode
        setEditingRegionId(region.id);
        setEditText(region.editedText);
        setTimeout(() => editInputRef.current?.focus(), 50);
      } else {
        // First click → select
        setSelectedRegionId(region.id);
        setEditingRegionId(null);
      }
    },
    [screenToImage, findRegionAt, commitEdit]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (modeRef.current === 'pan') return;

      const { x, y } = screenToImage(e.clientX, e.clientY);
      const region = findRegionAt(x, y);
      if (region) {
        // Commit any previous edit
        commitEdit();
        // Enter edit mode directly
        setSelectedRegionId(region.id);
        setEditingRegionId(region.id);
        setEditText(region.editedText);
        setTimeout(() => editInputRef.current?.focus(), 50);
      }
    },
    [screenToImage, findRegionAt, commitEdit]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        setOffset({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      } else if (isResizing) {
        const { x } = screenToImage(e.clientX, e.clientY);
        setRegions(prev => {
          const updated = prev.map(r => {
            if (r.id === selectedRegionIdRef.current) {
              if (isResizing === 'left') {
                const maxLeft = r.x + r.width - 10;
                const newX = Math.min(x, maxLeft);
                return { ...r, width: r.x + r.width - newX, x: newX };
              } else {
                const minRight = r.x + 10;
                const newRight = Math.max(x, minRight);
                return { ...r, width: newRight - r.x };
              }
            }
            return r;
          });
          if (workingCanvasRef.current) applyHistoryState(updated);
          return updated;
        });
      }
    },
    [isPanning, panStart, isResizing, screenToImage, applyHistoryState]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    if (isResizing) {
      setIsResizing(null);
      commitPropertyEdit();
    }
  }, [isResizing, commitPropertyEdit]);

  // ----- Zoom -----
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const currentScale = scaleRef.current;
      const newScale = Math.max(0.1, Math.min(5, currentScale + delta));

      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const currentOffset = offsetRef.current;

        setOffset({
          x: mouseX - (mouseX - currentOffset.x) * (newScale / currentScale),
          y: mouseY - (mouseY - currentOffset.y) * (newScale / currentScale),
        });
      }

      setScale(newScale);
    },
    []
  );

  // ----- Edit input handlers -----
  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitEdit();
      }
      if (e.key === 'Escape') {
        setEditingRegionId(null);
        setEditText('');
      }
    },
    [commitEdit]
  );

  const handleEditBlur = useCallback(() => {
    // Small delay to avoid blur firing when clicking another region
    setTimeout(() => commitEdit(), 100);
  }, [commitEdit]);

  // ----- Toolbar actions -----
  const zoomIn = () => setScale((s) => Math.min(5, s + 0.2));
  const zoomOut = () => setScale((s) => Math.max(0.1, s - 0.2));
  const resetView = () => {
    if (image && containerRef.current) {
      const containerW = containerRef.current.clientWidth;
      const containerH = containerRef.current.clientHeight;
      const fitScale = Math.min(
        (containerW - 80) / image.naturalWidth,
        (containerH - 80) / image.naturalHeight,
        1
      );
      setScale(fitScale);
      setOffset({
        x: (containerW - image.naturalWidth * fitScale) / 2,
        y: (containerH - image.naturalHeight * fitScale) / 2,
      });
    }
  };

  const handleExport = useCallback(async (format: 'png' | 'jpg' | 'jpeg') => {
    setShowExportMenu(false);
    const currentRegions = regionsRef.current;

    // Export always starts from the PRISTINE original pixels.
    const exportCanvasEl = clonePristine();
    if (exportCanvasEl.width === 0) {
      showNotification('Image not ready yet.');
      return;
    }

    currentRegions.forEach((r) => {
      if (r.editedText !== r.text) {
        inpaintRegion(exportCanvasEl, r.x, r.y, r.width, r.height, r.backgroundColor);
        if (r.editedText.trim().length > 0) {
          renderText(
            exportCanvasEl,
            r.editedText,
            r.x, r.y, r.width, r.height,
            r.fontSize, r.fontWeight, r.fontFamily,
            r.color, r.alignment,
            r.letterSpacing
          );
        }
      }
    });

    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const ext = format === 'jpeg' ? 'jpg' : format;
    const quality = mimeType === 'image/png' ? 1.0 : 0.95;
    const filename = `scantext-edited.${ext}`;
    const dataUrl = exportCanvasEl.toDataURL(mimeType, quality);

    // ── Step 1: Create Razorpay order ─────────────────────────────────
    try {
      showNotification('Creating payment…');
      const orderRes = await fetch('/api/payment/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!orderRes.ok) {
        const err = await orderRes.json().catch(() => ({}));
        throw new Error((err as any)?.error || 'Failed to create order');
      }

      const { orderId, amount, currency } = await orderRes.json();

      // ── Step 2: Open Razorpay checkout popup ──────────────────────────
      const razorpayKeyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
      if (!razorpayKeyId) {
        showNotification('Razorpay not configured.');
        return;
      }

      const Razorpay = (window as any).Razorpay;
      if (!Razorpay) {
        showNotification('Payment system loading, please try again…');
        return;
      }

      const options = {
        key: razorpayKeyId,
        amount,
        currency,
        name: 'ScanText',
        description: 'Image export — 1 download',
        order_id: orderId,
        handler: async (response: any) => {
          // ── Step 3: Verify payment server-side ──────────────────────────
          try {
            showNotification('Verifying payment…');
            const verifyRes = await fetch('/api/payment/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            if (!verifyRes.ok) {
              const err = await verifyRes.json().catch(() => ({}));
              throw new Error((err as any)?.error || 'Payment verification failed');
            }

            const { downloadToken } = await verifyRes.json();

            // ── Step 4: Download using the token ──────────────────────────
            showNotification('Downloading…');
            const exportRes = await fetch('/api/export', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                imageBase64: dataUrl,
                filename,
                mimeType,
                downloadToken,
              }),
            });

            if (!exportRes.ok) {
              const err = await exportRes.json().catch(() => ({}));
              throw new Error((err as any)?.error || 'Download failed');
            }

            const blob = await exportRes.blob();
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }, 60000);

            const sizeKb = Math.round(blob.size / 1024);
            showNotification(`Exported as ${ext.toUpperCase()} (${sizeKb} KB) ✓`);
          } catch (err) {
            console.error('Post-payment error:', err);
            const msg = err instanceof Error ? err.message : 'Download failed after payment.';
            showNotification(msg);
          }
        },
        modal: {
          ondismiss: () => {
            showNotification('Payment cancelled.');
          },
        },
        theme: {
          color: '#6366f1',
        },
      };

      const rzp = new Razorpay(options);
      rzp.open();
    } catch (err) {
      console.error('Export/payment error:', err);
      const msg = err instanceof Error ? err.message : 'Export failed.';
      showNotification(msg);
    }
  }, [showNotification, clonePristine]);

  const hasEdits = regions.some((r) => r.editedText !== r.text);

  // ----- Editing overlay position -----
  const editingRegion = editingRegionId
    ? regions.find((r) => r.id === editingRegionId)
    : null;

  const editInputStyle: React.CSSProperties = editingRegion
    ? {
        left: editingRegion.x * scale + offset.x,
        top: editingRegion.y * scale + offset.y,
        width: Math.max(editingRegion.width * scale + 20, 120),
        minHeight: Math.max(editingRegion.height * scale + 8, 32),
        fontSize: Math.max(editingRegion.fontSize * scale, 12),
        fontWeight: editingRegion.fontWeight === 'bold' ? 700 : 400,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        color: editingRegion.color,
        lineHeight: 1.2,
        resize: 'none' as const,
      }
    : {};

  const selectedRegion = selectedRegionId
    ? regions.find((r) => r.id === selectedRegionId)
    : null;

  return (
    <div className="editor-page">
      {/* Toolbar */}
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <div className="toolbar-brand" onClick={() => router.push('/')}>
            <div className="toolbar-brand-icon">
              <Sparkles size={14} color="white" />
            </div>
            <span>ScanText</span>
          </div>

          <button
            className="toolbar-btn"
            onClick={() => router.push('/')}
            title="Back to upload"
          >
            <ArrowLeft size={15} />
            <span className="btn-text">New</span>
          </button>
        </div>

        <div className="toolbar-center">
          <button
            className={`toolbar-btn ${mode === 'select' ? 'primary' : ''}`}
            onClick={() => setMode('select')}
            title="Select & Edit Text (click to select, click again or double-click to edit)"
          >
            <Type size={15} />
            <span className="btn-text">Select</span>
          </button>
          <button
            className={`toolbar-btn ${mode === 'pan' ? 'primary' : ''}`}
            onClick={() => setMode('pan')}
            title="Pan Canvas"
          >
            <Move size={15} />
            <span className="btn-text">Pan</span>
          </button>

          <div style={{ width: 1, height: 24, background: 'var(--border-color)', margin: '0 0.25rem' }} />

          <button
            className="toolbar-btn"
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            title="Undo (Ctrl+Z)"
          >
            <Undo size={15} />
          </button>
          <button
            className="toolbar-btn"
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            title="Redo (Ctrl+Y)"
          >
            <Redo size={15} />
          </button>

          <div style={{ width: 1, height: 24, background: 'var(--border-color)', margin: '0 0.25rem' }} />

          <button className="toolbar-btn" onClick={zoomOut} title="Zoom Out">
            <ZoomOut size={15} />
          </button>
          <span className="zoom-display">{Math.round(scale * 100)}%</span>
          <button className="toolbar-btn" onClick={zoomIn} title="Zoom In">
            <ZoomIn size={15} />
          </button>
          <button className="toolbar-btn" onClick={resetView} title="Reset View">
            <RotateCcw size={15} />
          </button>
        </div>

        <div className="toolbar-right">
          <span className="region-count">
            {regions.length} region{regions.length !== 1 ? 's' : ''} detected
          </span>
          <div className="export-dropdown-wrapper" style={{ position: 'relative' }}>
            <button
              className="toolbar-btn primary"
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={!hasEdits}
              title={hasEdits ? 'Export (₹1 per download)' : 'Make edits to export'}
            >
              <Download size={15} />
              <span className="btn-text">Export · ₹1</span>
              <ChevronDown size={14} style={{ marginLeft: 4 }} />
            </button>
            {showExportMenu && hasEdits && (
              <div 
                className="export-dropdown-menu" 
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '0.5rem',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: 'var(--shadow-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  zIndex: 1000,
                  minWidth: '120px'
                }}
              >
                <button 
                  className="dropdown-item" 
                  onClick={() => handleExport('png')}
                  style={{ padding: '0.75rem 1rem', background: 'transparent', border: 'none', color: 'var(--text-primary)', textAlign: 'left', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', width: '100%' }}
                >
                  PNG · ₹1
                </button>
                <button 
                  className="dropdown-item" 
                  onClick={() => handleExport('jpg')}
                  style={{ padding: '0.75rem 1rem', background: 'transparent', border: 'none', color: 'var(--text-primary)', textAlign: 'left', cursor: 'pointer', width: '100%' }}
                >
                  JPG · ₹1
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Canvas Area */}
      <div
        ref={containerRef}
        className="editor-canvas-wrapper"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        style={{
          cursor: isResizing 
            ? 'ew-resize'
            : (mode === 'pan' || isPanning
              ? (isPanning ? 'grabbing' : 'grab')
              : 'crosshair'),
        }}
      >
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />

        {/* Inline edit textarea */}
        {editingRegion && (
          <textarea
            ref={editInputRef}
            className="text-edit-input"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={handleEditBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={editInputStyle}
          />
        )}

        {/* Loading overlay */}
        {isProcessing && (
          <div className="loading-overlay">
            <div className="loading-spinner" />
            <div className="loading-text">
              <h3>{progress.status || 'Processing...'}</h3>
              <p>This may take a few seconds</p>
            </div>
            <div className="loading-progress">
              <div
                className="loading-progress-bar"
                style={{ width: `${Math.round(progress.progress * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Selected Region Sidebar */}
      <div className={`editor-sidebar ${selectedRegion ? 'open' : ''}`}>
        {selectedRegion && (
          <>
            <h4 className="sidebar-title">Text Properties</h4>
            <div className="sidebar-field">
              <label>Text</label>
              <input
                value={
                  editingRegionId === selectedRegion.id
                    ? editText
                    : selectedRegion.editedText
                }
                onChange={(e) => {
                  setEditingRegionId(selectedRegion.id);
                  setEditText(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitEdit();
                  }
                }}
                onBlur={() => setTimeout(() => commitEdit(), 100)}
                placeholder="Edit text..."
              />
            </div>
            <div className="sidebar-field">
              <label>Font Size</label>
              <input
                type="number"
                value={Math.round(selectedRegion.fontSize)}
                onChange={(e) => updateSelectedRegion({ fontSize: Number(e.target.value) })}
                onBlur={commitPropertyEdit}
              />
            </div>
            <div className="sidebar-field">
              <label>Font Weight</label>
              <input
                type="text"
                value={selectedRegion.fontWeight}
                onChange={(e) => updateSelectedRegion({ fontWeight: e.target.value })}
                onBlur={commitPropertyEdit}
                placeholder="400, 700, bold..."
              />
            </div>
            <div className="sidebar-field">
              <label>Letter Spacing (px)</label>
              <input
                type="number"
                step="0.1"
                value={selectedRegion.letterSpacing || 0}
                onChange={(e) => updateSelectedRegion({ letterSpacing: Number(e.target.value) })}
                onBlur={commitPropertyEdit}
              />
            </div>
            <div className="sidebar-field">
              <label>Color</label>
              <input
                type="text"
                value={selectedRegion.color}
                onChange={(e) => updateSelectedRegion({ color: e.target.value })}
                onBlur={commitPropertyEdit}
              />
            </div>
            <div className="sidebar-field">
              <label>X Position</label>
              <input
                type="number"
                value={Math.round(selectedRegion.x)}
                onChange={(e) => updateSelectedRegion({ x: Number(e.target.value) })}
                onBlur={commitPropertyEdit}
              />
            </div>
            <div className="sidebar-field">
              <label>Y Position</label>
              <input
                type="number"
                value={Math.round(selectedRegion.y)}
                onChange={(e) => updateSelectedRegion({ y: Number(e.target.value) })}
                onBlur={commitPropertyEdit}
              />
            </div>
            <div className="sidebar-field">
              <label>Width</label>
              <input
                type="number"
                value={Math.round(selectedRegion.width)}
                onChange={(e) => updateSelectedRegion({ width: Number(e.target.value) })}
                onBlur={commitPropertyEdit}
              />
            </div>
            <div className="sidebar-field">
              <label>Height</label>
              <input
                type="number"
                value={Math.round(selectedRegion.height)}
                onChange={(e) => updateSelectedRegion({ height: Number(e.target.value) })}
                onBlur={commitPropertyEdit}
              />
            </div>
            <div className="sidebar-field">
              <label>Confidence</label>
              <input value={`${Math.round(selectedRegion.confidence)}%`} readOnly />
            </div>
          </>
        )}
      </div>

      {/* Toast notification */}
      <div className={`toast success ${showToast ? 'visible' : ''}`}>
        <Check size={16} />
        {toastMessage}
      </div>
    </div>
  );
}
