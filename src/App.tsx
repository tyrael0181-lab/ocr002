import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Download, Square, Type, MousePointer2, Trash2, Pipette, Plus, Minus, BringToFront, Undo2, Redo2, ScanLine } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import pptxgen from 'pptxgenjs';
import { jsPDF } from 'jspdf';
import { createWorker } from 'tesseract.js';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type Tool = 'select' | 'mask' | 'text' | 'eyedropper' | 'scan';
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | null;

interface CanvasObject {
  id: string;
  type: 'mask' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  color: string;
  fontSize?: number;
}

interface SlideData {
  id: number;
  canvas: HTMLCanvasElement;
  thumbnail: string;
  objects: CanvasObject[];
}

interface HistoryState {
  slides: { id: number; objects: CanvasObject[] }[];
  currentSlideIndex: number;
}

function App() {
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [currentColor, setCurrentColor] = useState('#FFFFFF');
  const [activeHandle, setActiveHandle] = useState<Handle>(null);
  const [maskColor, setMaskColor] = useState('#FFFFFF');
  const [textColor, setTextColor] = useState('#000000');
  const [isScanning, setIsScanning] = useState(false);

  // History management
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isInternalStateUpdate = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const dragOffset = useRef({ x: 0, y: 0 });
  const currentObjectRef = useRef<CanvasObject | null>(null);

  // Save state to history
  const saveToHistory = useCallback((currentSlides: SlideData[], index: number) => {
    if (isInternalStateUpdate.current) return;

    const newState: HistoryState = {
      slides: currentSlides.map(s => ({ id: s.id, objects: JSON.parse(JSON.stringify(s.objects)) })),
      currentSlideIndex: index
    };

    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(newState);
      if (newHistory.length > 50) newHistory.shift();
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      isInternalStateUpdate.current = true;
      const prevState = history[historyIndex - 1];
      setSlides(prevSlides => prevSlides.map(ps => {
        const histSlide = prevState.slides.find(hs => hs.id === ps.id);
        return histSlide ? { ...ps, objects: JSON.parse(JSON.stringify(histSlide.objects)) } : ps;
      }));
      setCurrentSlideIndex(prevState.currentSlideIndex);
      setHistoryIndex(historyIndex - 1);
      setSelectedObjectId(null);
      setEditingTextId(null);
      setTimeout(() => { isInternalStateUpdate.current = false; }, 0);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      isInternalStateUpdate.current = true;
      const nextState = history[historyIndex + 1];
      setSlides(prevSlides => prevSlides.map(ps => {
        const histSlide = nextState.slides.find(hs => hs.id === ps.id);
        return histSlide ? { ...ps, objects: JSON.parse(JSON.stringify(histSlide.objects)) } : ps;
      }));
      setCurrentSlideIndex(nextState.currentSlideIndex);
      setHistoryIndex(historyIndex + 1);
      setSelectedObjectId(null);
      setEditingTextId(null);
      setTimeout(() => { isInternalStateUpdate.current = false; }, 0);
    }
  }, [history, historyIndex]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement> | File) => {
    const file = event instanceof File ? event : event.target.files?.[0];
    if (!file || file.type !== 'application/pdf') return;

    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const loadedSlides: SlideData[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        // Calculate dynamic scale to prevent oversized canvasses
        const defaultViewport = page.getViewport({ scale: 1.0 });
        const maxDimension = 1920;
        const scale = Math.min(2.0, maxDimension / defaultViewport.width);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport, canvas } as any).promise;

        const thumbScale = 0.2;
        const thumbViewport = page.getViewport({ scale: thumbScale });
        const thumbCanvas = document.createElement('canvas');
        const thumbContext = thumbCanvas.getContext('2d');
        if (thumbContext) {
          thumbCanvas.height = thumbViewport.height;
          thumbCanvas.width = thumbViewport.width;
          await page.render({ canvasContext: thumbContext, viewport: thumbViewport, canvas: thumbCanvas } as any).promise;
        }

        loadedSlides.push({
          id: i,
          canvas: canvas,
          thumbnail: thumbCanvas.toDataURL(),
          objects: [],
        });
      }

      setSlides(loadedSlides);
      setCurrentSlideIndex(0);
      setHistory([{ slides: loadedSlides.map(s => ({ id: s.id, objects: [] })), currentSlideIndex: 0 }]);
      setHistoryIndex(0);
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Failed to load PDF. Please try another file.');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const generatePPTX = async (targetSlides: SlideData[], filename: string) => {
    if (targetSlides.length === 0) return;
    setIsExporting(true);

    try {
      const pres = new pptxgen();
      const PPTX_WIDTH = 10;
      const PPTX_HEIGHT = 5.625;

      for (const slideData of targetSlides) {
        const slide = pres.addSlide();
        const imgData = slideData.canvas.toDataURL('image/png');
        slide.addImage({
          data: imgData,
          x: 0, y: 0, w: PPTX_WIDTH, h: PPTX_HEIGHT
        });

        const canvasWidth = slideData.canvas.width;
        const scaleFactor = PPTX_WIDTH / canvasWidth;

        slideData.objects.forEach(obj => {
          const x = obj.x * scaleFactor;
          const y = obj.y * scaleFactor;
          const w = obj.width * scaleFactor;
          const h = obj.height * scaleFactor;

          if (obj.type === 'mask') {
            slide.addShape(pres.ShapeType.rect, {
              x, y, w, h,
              fill: { color: obj.color.replace('#', '') },
              line: { color: obj.color.replace('#', ''), width: 0 }
            });
          } else if (obj.type === 'text') {
            const fontSizePt = (obj.fontSize || 100) * scaleFactor * 72 * 0.9;
            slide.addText(obj.content || '', {
              x, y: y - (fontSizePt * 0.005),
              w, h: Math.max(h, fontSizePt * 0.02),
              fontSize: Math.round(fontSizePt),
              color: obj.color.replace('#', ''),
              fontFace: 'MS PGothic',
              bold: true,
              valign: 'top',
              align: 'left',
              margin: 0,
              line: { width: 0, color: obj.color.replace('#', ''), transparency: 100 },
              wrap: true
            });
          }
        });
      }

      await pres.writeFile({ fileName: filename });
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export PPTX.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportAll = () => generatePPTX(slides, `SlidePatcher_All_${Date.now()}.pptx`);
  const handleExportCurrent = () => {
    if (!currentSlide) return;
    generatePPTX([currentSlide], `SlidePatcher_Slide${currentSlideIndex + 1}_${Date.now()}.pptx`);
  };

  const generatePDF = async (targetSlides: SlideData[], filename: string) => {
    if (targetSlides.length === 0) return;
    setIsExporting(true);

    try {
      // Set orientation based on first slide
      const firstSlide = targetSlides[0];
      const orientation = firstSlide.canvas.width >= firstSlide.canvas.height ? 'landscape' : 'portrait';
      const pdf = new jsPDF({
        orientation,
        unit: 'px',
        format: [firstSlide.canvas.width, firstSlide.canvas.height],
        compress: true
      });

      for (let i = 0; i < targetSlides.length; i++) {
        const slideData = targetSlides[i];
        // Add new pages with dynamic orientation
        if (i > 0) {
          const pageOrientation = slideData.canvas.width >= slideData.canvas.height ? 'landscape' : 'portrait';
          pdf.addPage([slideData.canvas.width, slideData.canvas.height], pageOrientation);
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = slideData.canvas.width;
        tempCanvas.height = slideData.canvas.height;
        const ctx = tempCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(slideData.canvas, 0, 0);

          slideData.objects.forEach(obj => {
            if (obj.type === 'mask') {
              ctx.fillStyle = obj.color;
              ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
            } else if (obj.type === 'text') {
              ctx.fillStyle = obj.color;
              const fontSize = obj.fontSize || 100;
              ctx.font = `bold ${fontSize}px "MS PGothic", "MS Pゴシック", sans-serif`;
              ctx.textBaseline = 'top';

              // Improved multi-line rendering synchronized with editor
              const lines = (obj.content || '').split('\n');
              const lineHeight = fontSize * 1.2;
              lines.forEach((line, index) => {
                ctx.fillText(line, obj.x, obj.y + (index * lineHeight));
              });
            }
          });

          // Maintain optimized quality
          const imgData = tempCanvas.toDataURL('image/jpeg', 0.5);
          pdf.addImage(imgData, 'JPEG', 0, 0, slideData.canvas.width, slideData.canvas.height, undefined, 'FAST');
        }
      }

      pdf.save(filename);
    } catch (error) {
      console.error('PDF Export error:', error);
      alert('Failed to export PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDFAll = () => generatePDF(slides, `SlidePatcher_All_${Date.now()}.pdf`);
  const handleExportPDFCurrent = () => {
    if (!currentSlide) return;
    generatePDF([currentSlide], `SlidePatcher_Slide${currentSlideIndex + 1}_${Date.now()}.pdf`);
  };

  const currentSlide = slides[currentSlideIndex];
  const selectedObject = currentSlide?.objects.find(obj => obj.id === selectedObjectId);
  const editingObject = currentSlide?.objects.find(obj => obj.id === editingTextId);

  const getHandles = (obj: CanvasObject) => {
    return {
      nw: { x: obj.x, y: obj.y },
      n: { x: obj.x + obj.width / 2, y: obj.y },
      ne: { x: obj.x + obj.width, y: obj.y },
      e: { x: obj.x + obj.width, y: obj.y + obj.height / 2 },
      se: { x: obj.x + obj.width, y: obj.y + obj.height },
      s: { x: obj.x + obj.width / 2, y: obj.y + obj.height },
      sw: { x: obj.x, y: obj.y + obj.height },
      w: { x: obj.x, y: obj.y + obj.height / 2 },
    };
  };

  // Render Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentSlide) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(currentSlide.canvas, 0, 0);

    currentSlide.objects.forEach((obj) => {
      if (obj.type === 'mask') {
        ctx.fillStyle = obj.color;
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
      } else if (obj.type === 'text') {
        if (editingTextId === obj.id) return;

        ctx.fillStyle = obj.color;
        const fontSize = obj.fontSize || 60;
        ctx.font = `bold ${fontSize}px "MS PGothic", "MS Pゴシック", sans-serif`;
        ctx.textBaseline = 'top';

        const lines = (obj.content || '').split('\n');
        lines.forEach((line, i) => {
          ctx.fillText(line, obj.x, obj.y + (i * fontSize * 1.2));
        });
      }

      if (selectedObjectId === obj.id) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 4;
        ctx.strokeRect(obj.x - 2, obj.y - 2, obj.width + 4, obj.height + 4);

        // Draw handles
        const handleSize = 12;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;

        const handles = getHandles(obj);
        (Object.keys(handles) as (keyof typeof handles)[]).forEach((key) => {
          const h = handles[key];
          ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
          ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
        });
      }
    });

    if (isDrawing.current && currentObjectRef.current) {
      const obj = currentObjectRef.current;
      if (obj.type === 'mask') {
        ctx.fillStyle = obj.color;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = '#3b82f6';
        ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
      } else if (obj.type === 'text' && activeTool === 'scan') { // Scan ROI preview
        ctx.fillStyle = '#3b82f6';
        ctx.globalAlpha = 0.2;
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 5]);
        ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
        ctx.setLineDash([]);
      }
    }
  }, [currentSlide, selectedObjectId, editingTextId, slides, activeTool]);

  const getMousePos = (e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!currentSlide) return;
    const pos = getMousePos(e);

    if (activeTool === 'eyedropper') {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
          const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase()}`;
          setCurrentColor(hex);

          // Update the tool's memory based on what we're about to use
          // (Usually eyesropper is used to pick a background for a mask)
          setMaskColor(hex);

          if (selectedObjectId) {
            const obj = currentSlide.objects.find(o => o.id === selectedObjectId);
            if (obj && obj.type === 'text') setTextColor(hex);
            updateSelectedObject({ color: hex });
          }
          setActiveTool('select');
        }
      }
      return;
    }

    if (activeTool === 'select') {
      // Check handles first
      if (selectedObjectId) {
        const obj = currentSlide.objects.find(o => o.id === selectedObjectId);
        if (obj) {
          const handles = getHandles(obj);
          const handleSize = 20; // Slightly larger hit area for easier interaction
          const hit = (Object.keys(handles) as (keyof typeof handles)[]).find(key => {
            const h = handles[key];
            return pos.x >= h.x - handleSize / 2 && pos.x <= h.x + handleSize / 2 &&
              pos.y >= h.y - handleSize / 2 && pos.y <= h.y + handleSize / 2;
          });
          if (hit) {
            setActiveHandle(hit);
            return;
          }
        }
      }

      const hitIndex = [...currentSlide.objects].reverse().findIndex(obj =>
        pos.x >= obj.x && pos.x <= obj.x + obj.width &&
        pos.y >= obj.y && pos.y <= obj.y + obj.height
      );

      if (hitIndex !== -1) {
        const realIndex = currentSlide.objects.length - 1 - hitIndex;
        const updatedSlides = [...slides];
        const objects = updatedSlides[currentSlideIndex].objects;
        let obj = objects[realIndex];

        // Ctrl+Drag Duplication logic
        if (e.ctrlKey) {
          const newObj = {
            ...obj,
            id: crypto.randomUUID(),
          };
          objects.push(newObj);
          obj = newObj;
          setSelectedObjectId(newObj.id);
        } else {
          // Standard selection logic: move to front
          objects.splice(realIndex, 1);
          objects.push(obj);
          setSelectedObjectId(obj.id);
        }

        setCurrentColor(obj.color);
        setSlides(updatedSlides);

        isDragging.current = true;
        dragOffset.current = {
          x: pos.x - obj.x,
          y: pos.y - obj.y,
        };
      } else {
        setSelectedObjectId(null);
      }
    } else if (activeTool === 'mask') {
      isDrawing.current = true;
      startPos.current = pos;
      currentObjectRef.current = {
        id: crypto.randomUUID(),
        type: 'mask',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        color: currentColor,
      };
    } else if (activeTool === 'text') {
      const id = crypto.randomUUID();
      const newObj: CanvasObject = {
        id,
        type: 'text',
        x: pos.x,
        y: pos.y,
        width: 800, // Adjusted default width
        height: 150, // Adjusted default height
        content: '',
        color: currentColor === '#FFFFFF' ? '#000000' : currentColor,
        fontSize: 100, // High-res default font size
      };
      const updatedSlides = [...slides];
      updatedSlides[currentSlideIndex].objects.push(newObj);
      setSlides(updatedSlides);
      setSelectedObjectId(id);
      setEditingTextId(id);
      setCurrentColor(newObj.color);
      setActiveTool('select');
      saveToHistory(updatedSlides, currentSlideIndex);
    } else if (activeTool === 'scan') {
      isDrawing.current = true;
      startPos.current = pos;
      currentObjectRef.current = {
        id: 'scan-roi',
        type: 'text',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        color: '#FFFFFF',
        content: ''
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getMousePos(e);

    if (activeHandle && selectedObjectId) {
      const updatedSlides = [...slides];
      const obj = updatedSlides[currentSlideIndex].objects.find(o => o.id === selectedObjectId);
      if (obj) {
        const oldX = obj.x;
        const oldY = obj.y;
        const oldW = obj.width;
        const oldH = obj.height;

        if (activeHandle.includes('e')) obj.width = Math.max(10, pos.x - obj.x);
        if (activeHandle.includes('s')) obj.height = Math.max(10, pos.y - obj.y);
        if (activeHandle.includes('w')) {
          const newX = Math.min(pos.x, oldX + oldW - 10);
          obj.width = oldX + oldW - newX;
          obj.x = newX;
        }
        if (activeHandle.includes('n')) {
          const newY = Math.min(pos.y, oldY + oldH - 10);
          obj.height = oldY + oldH - newY;
          obj.y = newY;
        }
        setSlides(updatedSlides);
      }
      return;
    }

    // Set cursor for handles
    const canvas = canvasRef.current;
    if (canvas && activeTool === 'select' && selectedObjectId) {
      const obj = currentSlide.objects.find(o => o.id === selectedObjectId);
      if (obj) {
        const handles = getHandles(obj);
        const handleSize = 25;
        const hit = (Object.keys(handles) as (keyof typeof handles)[]).find(key => {
          const h = handles[key];
          return pos.x >= h.x - handleSize / 2 && pos.x <= h.x + handleSize / 2 &&
            pos.y >= h.y - handleSize / 2 && pos.y <= h.y + handleSize / 2;
        });
        if (hit) {
          if (hit === 'nw' || hit === 'se') canvas.style.cursor = 'nwse-resize';
          else if (hit === 'ne' || hit === 'sw') canvas.style.cursor = 'nesw-resize';
          else if (hit === 'n' || hit === 's') canvas.style.cursor = 'ns-resize';
          else if (hit === 'e' || hit === 'w') canvas.style.cursor = 'ew-resize';
        } else {
          canvas.style.cursor = 'default';
        }
      }
    } else if (canvas) {
      canvas.style.cursor = 'default';
    }

    if (isDragging.current && selectedObjectId) {
      const updatedSlides = [...slides];
      const obj = updatedSlides[currentSlideIndex].objects.find(o => o.id === selectedObjectId);
      if (obj) {
        obj.x = pos.x - dragOffset.current.x;
        obj.y = pos.y - dragOffset.current.y;
        setSlides(updatedSlides);
      }
      return;
    }

    if (isDrawing.current && currentObjectRef.current) {
      currentObjectRef.current = {
        ...currentObjectRef.current!,
        x: Math.min(pos.x, startPos.current.x),
        y: Math.min(pos.y, startPos.current.y),
        width: Math.abs(pos.x - startPos.current.x),
        height: Math.abs(pos.y - startPos.current.y),
      };
      setSlides([...slides]);
    }
  };

  const detectTextColor = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const data = ctx.getImageData(0, 0, width, height).data;
    const colorCounts: Record<string, number> = {};
    const backgroundColors = new Set<string>();

    // Sample edges to define background color range
    for (let x = 0; x < width; x++) {
      [0, height - 1].forEach(y => {
        const i = (y * width + x) * 4;
        backgroundColors.add(`${Math.floor(data[i] / 16)},${Math.floor(data[i + 1] / 16)},${Math.floor(data[i + 2] / 16)}`);
      });
    }
    for (let y = 0; y < height; y++) {
      [0, width - 1].forEach(x => {
        const i = (y * width + x) * 4;
        backgroundColors.add(`${Math.floor(data[i] / 16)},${Math.floor(data[i + 1] / 16)},${Math.floor(data[i + 2] / 16)}`);
      });
    }

    // Build histogram of non-background colors
    let maxCount = 0;
    let dominantColor = { r: 0, g: 0, b: 0 };

    for (let i = 0; i < data.length; i += 16) { // Sample step
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = `${Math.floor(r / 16)},${Math.floor(g / 16)},${Math.floor(b / 16)}`;

      if (!backgroundColors.has(key)) {
        colorCounts[key] = (colorCounts[key] || 0) + 1;
        if (colorCounts[key] > maxCount) {
          maxCount = colorCounts[key];
          dominantColor = { r, g, b };
        }
      }
    }

    // Fallback if no non-background color found (e.g. all ROI is text or background)
    if (maxCount === 0) {
      return '#000000';
    }

    const toHex = (c: number) => c.toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(dominantColor.r)}${toHex(dominantColor.g)}${toHex(dominantColor.b)}`;
  };

  const performOCR = async (roi: CanvasObject) => {
    if (!currentSlide || roi.width < 10 || roi.height < 10) return;
    setIsScanning(true);
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = roi.width;
      tempCanvas.height = roi.height;
      const tctx = tempCanvas.getContext('2d');
      if (!tctx) return;

      tctx.drawImage(currentSlide.canvas, roi.x, roi.y, roi.width, roi.height, 0, 0, roi.width, roi.height);

      const worker = await createWorker('jpn+eng');
      const { data } = await worker.recognize(tempCanvas);
      await worker.terminate();

      const text = data.text;
      if (text.trim()) {
        const cleanedText = text.trim()
          .replace(/([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF])\s+(?=[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF])/g, '$1')
          .replace(/([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF])\s+(?=[a-zA-Z0-9])/g, '$1')
          .replace(/([a-zA-Z0-9])\s+(?=[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF])/g, '$1');

        const detectedColor = detectTextColor(tctx, roi.width, roi.height);

        let avgLineHeight = 60;
        const pageData = data as any;
        if (pageData.lines && pageData.lines.length > 0) {
          const sumHeight = pageData.lines.reduce((acc: number, line: any) => acc + (line.bbox.y1 - line.bbox.y0), 0);
          avgLineHeight = sumHeight / pageData.lines.length;
        }

        const id = crypto.randomUUID();
        // Calibrate font size: Tesseract's bbox is tight, we scale up slightly (1.2x) to match visual size of MS P Gothic
        const calibratedSize = Math.max(12, Math.round(avgLineHeight * 1.2));

        const newObj: CanvasObject = {
          id,
          type: 'text',
          x: roi.x,
          y: roi.y,
          width: roi.width,
          height: roi.height,
          content: cleanedText,
          color: detectedColor,
          fontSize: calibratedSize,
        };
        const updatedSlides = [...slides];
        updatedSlides[currentSlideIndex].objects.push(newObj);
        setSlides(updatedSlides);
        setSelectedObjectId(id);
        setActiveTool('select');
        saveToHistory(updatedSlides, currentSlideIndex);
      }
    } catch (err) {
      console.error('OCR Error:', err);
      alert('OCR failed. Please try again.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleMouseUp = () => {
    if (isDrawing.current && currentObjectRef.current) {
      if (activeTool === 'scan') {
        performOCR(currentObjectRef.current);
      } else if (currentObjectRef.current.width > 5 && currentObjectRef.current.height > 5) {
        const updatedSlides = [...slides];
        updatedSlides[currentSlideIndex].objects.push(currentObjectRef.current);
        setSlides(updatedSlides);
        setSelectedObjectId(currentObjectRef.current.id);
        setActiveTool('select');
        saveToHistory(updatedSlides, currentSlideIndex);
      }
    }
    if (isDragging.current || activeHandle) {
      saveToHistory(slides, currentSlideIndex);
    }
    isDrawing.current = false;
    isDragging.current = false;
    currentObjectRef.current = null;
    setActiveHandle(null);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (activeTool !== 'select' || !currentSlide) return;
    const pos = getMousePos(e);
    const hit = [...currentSlide.objects].reverse().find(obj =>
      obj.type === 'text' &&
      pos.x >= obj.x && pos.x <= obj.x + obj.width &&
      pos.y >= obj.y && pos.y <= obj.y + obj.height
    );
    if (hit) {
      setEditingTextId(hit.id);
      setSelectedObjectId(hit.id);
    }
  };

  const updateSelectedObject = (updates: Partial<CanvasObject>) => {
    if (!selectedObjectId || !currentSlide) return;
    const updatedSlides = [...slides];
    const obj = updatedSlides[currentSlideIndex].objects.find(o => o.id === selectedObjectId);
    if (obj) {
      Object.assign(obj, updates);
      setSlides(updatedSlides);
    }
  };

  const bringToFront = () => {
    if (!selectedObjectId || !currentSlide) return;
    const updatedSlides = [...slides];
    const objects = updatedSlides[currentSlideIndex].objects;
    const index = objects.findIndex(o => o.id === selectedObjectId);
    if (index !== -1) {
      const [obj] = objects.splice(index, 1);
      objects.push(obj);
      setSlides(updatedSlides);
      saveToHistory(updatedSlides, currentSlideIndex);
    }
  };

  const deleteSelected = useCallback(() => {
    if (!selectedObjectId || !currentSlide) return;
    const updatedSlides = [...slides];
    updatedSlides[currentSlideIndex].objects = currentSlide.objects.filter(o => o.id !== selectedObjectId);
    setSlides(updatedSlides);
    setSelectedObjectId(null);
    setEditingTextId(null);
    saveToHistory(updatedSlides, currentSlideIndex);
  }, [selectedObjectId, currentSlide, slides, currentSlideIndex, saveToHistory]);


  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingTextId) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObjectId) deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key.toLowerCase() === 's') {
        setActiveTool('select');
      } else if (e.key.toLowerCase() === 'm') {
        setActiveTool('mask');
      } else if (e.key.toLowerCase() === 't') {
        setActiveTool('text');
      } else if (e.key.toLowerCase() === 'e') {
        setActiveTool('eyedropper');
      } else if (e.key.toLowerCase() === 'r') {
        setActiveTool('scan');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObjectId, editingTextId, deleteSelected, undo, redo]);

  return (
    <div className="h-screen bg-neutral-900 flex flex-col font-sans text-neutral-100 overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-neutral-800 bg-neutral-950 flex items-center justify-between px-6 shrink-0 z-40 shadow-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-lg">S</div>
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400 tracking-tight">
            Slide Patcher
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-neutral-900 rounded-lg p-1 border border-neutral-800 mr-2">
            <button
              onClick={undo}
              disabled={historyIndex <= 0}
              className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent rounded transition-colors"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={18} />
            </button>
            <button
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent rounded transition-colors"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={18} />
            </button>
          </div>

          {selectedObjectId && (
            <div className="flex items-center gap-1 bg-neutral-900 rounded-lg p-1 border border-neutral-800">
              <button
                onClick={bringToFront}
                className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
                title="Bring to Front"
              >
                <BringToFront size={18} />
              </button>
              <div className="w-px h-4 bg-neutral-800 mx-1" />
              <button
                onClick={deleteSelected}
                className="p-1.5 text-red-400 hover:bg-red-950/50 rounded transition-colors"
                title="Delete object (Delete)"
              >
                <Trash2 size={18} />
              </button>
            </div>
          )}
          <div className="flex gap-4">
            {/* PowerPoint Group */}
            <div className="flex bg-neutral-900 p-1.5 rounded-xl border border-neutral-800 shadow-inner gap-1">
              <button
                onClick={handleExportCurrent}
                disabled={slides.length === 0 || isExporting}
                className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-neutral-400 font-bold hover:text-white hover:bg-neutral-800 rounded-lg transition-all active:scale-90"
              >
                PPT Current
              </button>
              <button
                onClick={handleExportAll}
                disabled={slides.length === 0 || isExporting}
                className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-[#D24726] to-[#A2361E] text-white text-[11px] font-extrabold rounded-lg shadow-md transition-all hover:scale-105 hover:shadow-[#D24726]/30 hover:shadow-lg active:scale-95"
              >
                PPT All
              </button>
            </div>

            {/* PDF Group */}
            <div className="flex bg-neutral-900 p-1.5 rounded-xl border border-neutral-800 shadow-inner gap-1">
              <button
                onClick={handleExportPDFCurrent}
                disabled={slides.length === 0 || isExporting}
                className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-neutral-400 font-bold hover:text-white hover:bg-neutral-800 rounded-lg transition-all active:scale-90"
              >
                PDF Current
              </button>
              <button
                onClick={handleExportPDFAll}
                disabled={slides.length === 0 || isExporting}
                className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-[#E41E10] to-[#B30B00] text-white text-[11px] font-extrabold rounded-lg shadow-md transition-all hover:scale-105 hover:shadow-[#E41E10]/30 hover:shadow-lg active:scale-95"
              >
                {isExporting ? (
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  'PDF All'
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Sidebar */}
        <aside className="w-64 border-r border-neutral-300 bg-[#F3F2F1] flex flex-col shrink-0">
          <div className="p-3 border-b border-neutral-200 flex items-center justify-between bg-white/50">
            <h2 className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Slides</h2>
            <span className="text-[10px] font-bold text-neutral-500 bg-neutral-200 px-2 py-0.5 rounded-full">{slides.length}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-3 scrollbar-thin scrollbar-thumb-neutral-300 scrollbar-track-transparent">
            {slides.length === 0 ? (
              <div className="aspect-video bg-white/50 rounded border-2 border-dashed border-neutral-200 flex items-center justify-center text-neutral-400 text-xs italic p-4 text-center">
                Upload PDF
              </div>
            ) : (
              slides.map((slide, index) => (
                <div
                  key={slide.id}
                  onClick={() => {
                    setCurrentSlideIndex(index);
                    setSelectedObjectId(null);
                    setEditingTextId(null);
                  }}
                  className="flex items-start gap-2 group cursor-pointer"
                >
                  <span className={`w-5 text-[11px] mt-2 font-medium text-right transition-colors ${currentSlideIndex === index ? 'text-[#C43E1C]' : 'text-neutral-400 group-hover:text-neutral-600'}`}>
                    {index + 1}
                  </span>
                  <div className={`relative flex-1 aspect-video bg-white border-2 transition-all shadow-sm ${currentSlideIndex === index ? 'border-[#C43E1C] shadow-md ring-2 ring-[#C43E1C]/10' : 'border-neutral-200 group-hover:border-neutral-300'
                    }`}>
                    <img src={slide.thumbnail} alt={`Slide ${index + 1}`} className="w-full h-full object-contain" />
                    {slide.objects.length > 0 && (
                      <div className="absolute top-0 left-0 bg-[#C43E1C] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-br shadow-sm z-10">
                        {slide.objects.length}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Toolbar Rail */}
        <aside className="w-16 border-r border-neutral-800 bg-neutral-950 flex flex-col items-center py-4 gap-4 shrink-0 shadow-lg z-10">
          <button
            onClick={() => setActiveTool('select')}
            className={`p-2.5 rounded-xl transition-all ${activeTool === 'select' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' : 'text-neutral-500 hover:bg-neutral-800 hover:text-white'}`}
            title="Selection Tool (S)"
          >
            <MousePointer2 size={24} />
          </button>
          <div className="h-px w-8 bg-neutral-800" />
          <button
            onClick={() => {
              setActiveTool('mask');
              setCurrentColor(maskColor);
            }}
            className={`p-2.5 rounded-xl transition-all ${activeTool === 'mask' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' : 'text-neutral-500 hover:bg-neutral-800 hover:text-white'}`}
            title="Mask Tool (M)"
          >
            <Square size={24} />
          </button>
          <button
            onClick={() => {
              setActiveTool('text');
              setCurrentColor(textColor);
            }}
            className={`p-2.5 rounded-xl transition-all ${activeTool === 'text' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' : 'text-neutral-500 hover:bg-neutral-800 hover:text-white'}`}
            title="Text Tool (T)"
          >
            <Type size={24} />
          </button>
          <button
            onClick={() => setActiveTool('eyedropper')}
            className={`p-2.5 rounded-xl transition-all ${activeTool === 'eyedropper' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' : 'text-neutral-500 hover:bg-neutral-800 hover:text-white'}`}
            title="Eyedropper (E)"
          >
            <Pipette size={24} />
          </button>
          <button
            onClick={() => setActiveTool('scan')}
            className={`p-2.5 rounded-xl transition-all ${activeTool === 'scan' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' : 'text-neutral-500 hover:bg-neutral-800 hover:text-white'}`}
            title="Smart OCR Scan (R)"
          >
            <ScanLine size={24} />
          </button>

          {isScanning && (
            <div className="flex flex-col items-center gap-1">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-[10px] font-bold text-blue-400">Scanning</span>
            </div>
          )}

          <div className="mt-auto flex flex-col items-center gap-4 py-2">
            {selectedObject && selectedObject.type === 'text' && (
              <div className="flex flex-col gap-2 bg-neutral-800 p-1.5 rounded-xl border border-neutral-700">
                <button
                  onClick={() => {
                    const nextSize = (selectedObject.fontSize || 100) + 8;
                    updateSelectedObject({ fontSize: nextSize });
                    saveToHistory(slides, currentSlideIndex);
                  }}
                  className="p-1 hover:bg-neutral-700 rounded text-neutral-300"
                  title="Increase font size"
                >
                  <Plus size={16} />
                </button>
                <div className="text-[10px] font-bold text-center text-neutral-500">{selectedObject.fontSize}</div>
                <button
                  onClick={() => {
                    const nextSize = Math.max(8, (selectedObject.fontSize || 100) - 8);
                    updateSelectedObject({ fontSize: nextSize });
                    saveToHistory(slides, currentSlideIndex);
                  }}
                  className="p-1 hover:bg-neutral-700 rounded text-neutral-300"
                  title="Decrease font size"
                >
                  <Minus size={16} />
                </button>
              </div>
            )}

            <div className="relative group overflow-hidden rounded-xl border-2 border-neutral-700 shadow-inner group-hover:ring-blue-500/50 transition-all">
              <input
                type="color"
                value={currentColor}
                onChange={(e) => {
                  const color = e.target.value;
                  setCurrentColor(color);
                  if (activeTool === 'mask') setMaskColor(color);
                  else if (activeTool === 'text') setTextColor(color);

                  if (selectedObjectId) {
                    const obj = currentSlide.objects.find(o => o.id === selectedObjectId);
                    if (obj) {
                      if (obj.type === 'mask') setMaskColor(color);
                      else setTextColor(color);
                    }
                    updateSelectedObject({ color });
                  }
                }}
                onBlur={() => {
                  if (selectedObjectId) saveToHistory(slides, currentSlideIndex);
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <div
                className="w-10 h-10"
                style={{ backgroundColor: currentColor }}
              />
            </div>
          </div>
        </aside>

        {/* Editor Area */}
        <section className="flex-1 bg-[#E6E6E6] relative overflow-hidden flex flex-col">
          <div className="flex-1 overflow-auto flex items-start justify-center p-12">
            {isProcessing ? (
              <div className="m-auto flex flex-col items-center gap-4 bg-neutral-800 p-10 rounded-[2rem] shadow-2xl border border-neutral-700">
                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <div className="text-center">
                  <p className="text-base font-bold text-white tracking-widest uppercase">Processing PDF</p>
                  <p className="text-xs text-neutral-500 mt-2 font-mono uppercase">EXTRACTING_LAYERS</p>
                </div>
              </div>
            ) : slides.length > 0 ? (
              <div
                className={`relative shadow-[0_0_100px_rgba(0,0,0,0.5)] bg-black leading-[0] ring-1 ring-white/10 ${activeTool !== 'select' ? 'cursor-crosshair' : 'cursor-default'} ${isDragging.current ? 'cursor-grabbing' : ''}`}
                style={{ maxWidth: 'min-content' }}
              >
                <canvas
                  ref={canvasRef}
                  width={currentSlide?.canvas.width}
                  height={currentSlide?.canvas.height}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onDoubleClick={handleDoubleClick}
                  className="max-w-[calc(100vw-22rem)] max-h-[calc(100vh-10rem)] w-auto h-auto block object-contain shadow-2xl"
                />

                {/* Inline Text Editor Overlay */}
                {editingObject && (
                  <textarea
                    autoFocus
                    placeholder="Type here..."
                    className="absolute z-50 p-4 bg-neutral-900/95 text-white border-4 border-blue-500 rounded-xl focus:outline-none resize-none font-bold leading-[1.2] shadow-2xl backdrop-blur-xl overflow-hidden"
                    style={{
                      left: (editingObject.x / currentSlide.canvas.width) * 100 + '%',
                      top: (editingObject.y / currentSlide.canvas.height) * 100 + '%',
                      width: Math.max(30, (editingObject.width / currentSlide.canvas.width) * 100) + '%',
                      height: Math.max(15, (editingObject.height / currentSlide.canvas.height) * 100) + '%',
                      fontSize: (editingObject.fontSize || 100) * (canvasRef.current?.getBoundingClientRect().width || 1) / (currentSlide.canvas.width || 1) + 'px',
                      fontFamily: '"MS PGothic", "MS Pゴシック", sans-serif',
                      color: editingObject.color,
                      textShadow: editingObject.color === '#FFFFFF' ? '0 0 4px rgba(0,0,0,0.8)' : 'none',
                    }}
                    value={editingObject.content}
                    onChange={(e) => updateSelectedObject({ content: e.target.value })}
                    onMouseDown={(e) => {
                      const pos = getMousePos(e);
                      const handles = getHandles(editingObject);
                      const isHandle = (Object.keys(handles) as (keyof typeof handles)[]).some(key => {
                        const h = handles[key];
                        return pos.x >= h.x - 20 && pos.x <= h.x + 20 &&
                          pos.y >= h.y - 20 && pos.y <= h.y + 20;
                      });
                      if (isHandle) {
                        handleMouseDown(e);
                      }
                    }}
                    onBlur={() => {
                      // Only blur if not currently resizing
                      if (!activeHandle) {
                        setEditingTextId(null);
                        saveToHistory(slides, currentSlideIndex);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        setEditingTextId(null);
                        saveToHistory(slides, currentSlideIndex);
                      }
                    }}
                  />
                )}

                <div className="absolute -bottom-8 left-0 right-0 flex justify-center">
                  <div className="bg-black/60 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-bold text-neutral-400 border border-white/5">
                    {currentSlideIndex + 1} / {slides.length} • {currentSlide?.canvas.width}x{currentSlide?.canvas.height}px
                  </div>
                </div>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                className="m-auto max-w-2xl w-full aspect-[16/10] bg-neutral-950 shadow-2xl rounded-[3rem] border-2 border-dashed border-neutral-800 flex flex-col items-center justify-center gap-8 text-neutral-600 hover:border-blue-500/50 hover:bg-blue-500/[0.02] transition-all duration-700 cursor-pointer group px-12"
              >
                <div className="w-24 h-24 bg-neutral-900 border border-neutral-800 text-neutral-700 group-hover:bg-blue-950 group-hover:text-blue-400 group-hover:border-blue-900 rounded-[2.5rem] flex items-center justify-center transition-all duration-700 shadow-inner group-hover:rotate-6 group-hover:scale-110">
                  <Upload size={48} strokeWidth={1} />
                </div>
                <div className="text-center">
                  <h3 className="text-2xl font-bold text-neutral-100 mb-2">Drop your PDF here</h3>
                  <p className="text-base text-neutral-500 px-8 italic text-pretty">Supports shortcuts (Ctrl+Z/Y) and PPTX export.</p>
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="application/pdf"
                  onChange={handleFileUpload}
                />
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
