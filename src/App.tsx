import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Download, Square, Type, MousePointer2, Trash2, Pipette, Plus, Minus, BringToFront, Undo2, Redo2 } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import pptxgen from 'pptxgenjs';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type Tool = 'select' | 'mask' | 'text' | 'eyedropper';

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

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || file.type !== 'application/pdf') return;

    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const loadedSlides: SlideData[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport }).promise;

        const thumbScale = 0.2;
        const thumbViewport = page.getViewport({ scale: thumbScale });
        const thumbCanvas = document.createElement('canvas');
        const thumbContext = thumbCanvas.getContext('2d');
        if (thumbContext) {
          thumbCanvas.height = thumbViewport.height;
          thumbCanvas.width = thumbViewport.width;
          await page.render({ canvasContext: thumbContext, viewport: thumbViewport }).promise;
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

  const handleExport = async () => {
    if (slides.length === 0) return;
    setIsExporting(true);

    try {
      const pres = new pptxgen();

      for (const slideData of slides) {
        const slide = pres.addSlide();

        const imgData = slideData.canvas.toDataURL('image/png');
        slide.addImage({
          data: imgData,
          x: 0,
          y: 0,
          w: '100%',
          h: '100%'
        });

        const canvasWidth = slideData.canvas.width;
        const canvasHeight = slideData.canvas.height;

        const pptWidth = 10;
        const pptHeight = 5.625;

        slideData.objects.forEach(obj => {
          const x = (obj.x / canvasWidth) * pptWidth;
          const y = (obj.y / canvasHeight) * pptHeight;
          const w = (obj.width / canvasWidth) * pptWidth;
          const h = (obj.height / canvasHeight) * pptHeight;

          if (obj.type === 'mask') {
            slide.addShape(pres.ShapeType.rect, {
              x, y, w, h,
              fill: { color: obj.color.replace('#', '') },
              line: { width: 0 }
            });
          } else if (obj.type === 'text') {
            slide.addText(obj.content || '', {
              x, y, w, h: Math.max(h, 0.4),
              fontSize: (obj.fontSize || 20) * 0.5,
              color: obj.color.replace('#', ''),
              bold: true,
              valign: 'top',
              align: 'left'
            });
          }
        });
      }

      await pres.writeFile({ fileName: `SlidePatcher_Export_${Date.now()}.pptx` });
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export PPTX.');
    } finally {
      setIsExporting(false);
    }
  };

  const currentSlide = slides[currentSlideIndex];
  const selectedObject = currentSlide?.objects.find(obj => obj.id === selectedObjectId);
  const editingObject = currentSlide?.objects.find(obj => obj.id === editingTextId);

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
        const fontSize = obj.fontSize || 20;
        ctx.font = `bold ${fontSize}px sans-serif`;
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
      }
    }
  }, [currentSlide, selectedObjectId, editingTextId, slides]);

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
    if (!currentSlide || editingTextId) return;
    const pos = getMousePos(e);

    if (activeTool === 'eyedropper') {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
          const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase()}`;
          setCurrentColor(hex);
          if (selectedObjectId) {
            updateSelectedObject({ color: hex });
          }
          setActiveTool('select');
        }
      }
      return;
    }

    if (activeTool === 'select') {
      const hitIndex = [...currentSlide.objects].reverse().findIndex(obj =>
        pos.x >= obj.x && pos.x <= obj.x + obj.width &&
        pos.y >= obj.y && pos.y <= obj.y + obj.height
      );

      if (hitIndex !== -1) {
        const realIndex = currentSlide.objects.length - 1 - hitIndex;
        const obj = currentSlide.objects[realIndex];
        setSelectedObjectId(obj.id);
        setCurrentColor(obj.color);
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
        width: 600,
        height: 120,
        content: '',
        color: currentColor === '#FFFFFF' ? '#000000' : currentColor,
        fontSize: 60,
      };
      const updatedSlides = [...slides];
      updatedSlides[currentSlideIndex].objects.push(newObj);
      setSlides(updatedSlides);
      setSelectedObjectId(id);
      setEditingTextId(id);
      setCurrentColor(newObj.color);
      setActiveTool('select');
      saveToHistory(updatedSlides, currentSlideIndex);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (editingTextId) return;
    const pos = getMousePos(e);

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

  const handleMouseUp = () => {
    if (isDrawing.current && currentObjectRef.current) {
      if (currentObjectRef.current.width > 5 && currentObjectRef.current.height > 5) {
        const updatedSlides = [...slides];
        updatedSlides[currentSlideIndex].objects.push(currentObjectRef.current);
        setSlides(updatedSlides);
        setSelectedObjectId(currentObjectRef.current.id);
        saveToHistory(updatedSlides, currentSlideIndex);
      }
    }
    if (isDragging.current) {
      saveToHistory(slides, currentSlideIndex);
    }
    isDrawing.current = false;
    isDragging.current = false;
    currentObjectRef.current = null;
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
      // History will be saved on blur/mouseup or after specific actions
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
      if (editingTextId) return; // Disable shortcuts while editing text

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObjectId) deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
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
          <button
            onClick={handleExport}
            disabled={slides.length === 0 || isExporting}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-semibold hover:shadow-lg hover:shadow-blue-900/20 disabled:from-neutral-800 disabled:to-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed transition-all shadow-md active:scale-95"
          >
            {isExporting ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <Download size={18} />
            )}
            {isExporting ? 'Exporting...' : 'Export PPTX'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Sidebar */}
        <aside className="w-64 border-r border-neutral-800 bg-neutral-950 flex flex-col shrink-0">
          <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
            <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Slides</h2>
            <span className="text-xs font-bold text-blue-400 bg-blue-950 px-2 py-0.5 rounded-full">{slides.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 bg-neutral-950">
            {slides.length === 0 ? (
              <div className="aspect-video bg-neutral-900 rounded-xl border-2 border-dashed border-neutral-800 flex items-center justify-center text-neutral-600 text-xs italic p-4 text-center text-pretty">
                Upload a PDF to start
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
                  className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all shadow-sm ${currentSlideIndex === index ? 'border-blue-500 ring-4 ring-blue-500/20 scale-[0.98]' : 'border-transparent hover:border-neutral-800'
                    }`}
                >
                  <img src={slide.thumbnail} alt={`Slide ${index + 1}`} className="w-full aspect-video object-cover bg-black" />
                  <div className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] font-bold px-2 py-0.5 rounded backdrop-blur-md border border-white/10">
                    {index + 1}
                  </div>
                  {slide.objects.length > 0 && (
                    <div className="absolute top-1 left-1 bg-blue-600 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-md">
                      {slide.objects.length}
                    </div>
                  )}
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
            onClick={() => setActiveTool('mask')}
            className={`p-2.5 rounded-xl transition-all ${activeTool === 'mask' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' : 'text-neutral-500 hover:bg-neutral-800 hover:text-white'}`}
            title="Mask Tool (M)"
          >
            <Square size={24} />
          </button>
          <button
            onClick={() => setActiveTool('text')}
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

          <div className="mt-auto flex flex-col items-center gap-4 py-2">
            {selectedObject && selectedObject.type === 'text' && (
              <div className="flex flex-col gap-2 bg-neutral-800 p-1.5 rounded-xl border border-neutral-700">
                <button
                  onClick={() => {
                    const nextSize = (selectedObject.fontSize || 20) + 4;
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
                    const nextSize = Math.max(8, (selectedObject.fontSize || 20) - 4);
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

            <div className="relative group">
              <input
                type="color"
                value={currentColor}
                onChange={(e) => {
                  setCurrentColor(e.target.value);
                  if (selectedObjectId) updateSelectedObject({ color: e.target.value });
                }}
                onBlur={() => {
                  if (selectedObjectId) saveToHistory(slides, currentSlideIndex);
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <div
                className="w-10 h-10 rounded-xl border-2 border-neutral-700 shadow-inner overflow-hidden ring-2 ring-transparent group-hover:ring-blue-500/50 transition-all"
                style={{ backgroundColor: currentColor }}
              />
            </div>
          </div>
        </aside>

        {/* Editor Area */}
        <section className="flex-1 bg-neutral-900 relative overflow-hidden flex flex-col">
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
                    className="absolute z-50 p-4 bg-neutral-900/90 text-white border-4 border-blue-500 rounded-xl focus:outline-none resize-none font-bold leading-[1.2] shadow-2xl backdrop-blur-xl overflow-hidden"
                    style={{
                      left: (editingObject.x / currentSlide.canvas.width) * 100 + '%',
                      top: (editingObject.y / currentSlide.canvas.height) * 100 + '%',
                      width: Math.max(30, (editingObject.width / currentSlide.canvas.width) * 100) + '%',
                      height: Math.max(15, (editingObject.height / currentSlide.canvas.height) * 100) + '%',
                      fontSize: (editingObject.fontSize || 20) * (canvasRef.current?.getBoundingClientRect().width || 1) / (currentSlide.canvas.width || 1) + 'px',
                      color: editingObject.color,
                      textShadow: editingObject.color === '#FFFFFF' ? '0 0 4px rgba(0,0,0,0.8)' : 'none',
                    }}
                    value={editingObject.content}
                    onChange={(e) => updateSelectedObject({ content: e.target.value })}
                    onBlur={() => {
                      setEditingTextId(null);
                      saveToHistory(slides, currentSlideIndex);
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
