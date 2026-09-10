import { t } from '@/i18n';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { usePresentationStore } from '@/stores/presentation';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { safeHtml } from '@/utils';
type TransitionType = 'none' | 'fade' | 'slide' | 'zoom' | 'flip';
export default function PreviewPage() {
  const { id } = useParams<{
    id: string;
  }>();
  const loadPresentation = usePresentationStore((s) => s.loadPresentation);
  const presentation = usePresentationStore((s) => s.presentation);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<'next' | 'prev'>('next');
  useEffect(() => {
    if (id) {
      loadPresentation(id);
    }
  }, [id, loadPresentation]);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!presentation) return;
      const nextKeys = ['ArrowRight', ' ', 'PageDown', 'Enter'];
      const prevKeys = ['ArrowLeft', 'PageUp', 'Backspace'];
      const isNext = nextKeys.includes(e.key) || e.code === 'Numpad6';
      const isPrev = prevKeys.includes(e.key) || e.code === 'Numpad4';
      if (isNext) {
        e.preventDefault();
        goToSlide(Math.min(currentIndex + 1, presentation.slides.length - 1), 'next');
      } else if (isPrev) {
        e.preventDefault();
        goToSlide(Math.max(currentIndex - 1, 0), 'prev');
      } else if (e.key === 'Escape') {
        window.history.back();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToSlide(0, 'prev');
      } else if (e.key === 'End') {
        e.preventDefault();
        goToSlide(presentation.slides.length - 1, 'next');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [presentation, currentIndex]);
  const transition: TransitionType = (presentation?.transition as TransitionType) || 'none';
  const goToSlide = (newIndex: number, direction: 'next' | 'prev') => {
    if (newIndex === currentIndex || isTransitioning || !presentation) return;
    if (transition === 'none') {
      setCurrentIndex(newIndex);
      setPrevIndex(newIndex);
      return;
    }
    setPrevIndex(currentIndex);
    setTransitionDirection(direction);
    setIsTransitioning(true);
    setCurrentIndex(newIndex);
    setTimeout(() => {
      setIsTransitioning(false);
      setPrevIndex(newIndex);
    }, 300);
  };
  if (!presentation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <p className="text-white">{t('加载中...')}</p>
      </div>
    );
  }
  const currentSlide = presentation.slides[currentIndex];
  const prevSlide = presentation.slides[prevIndex];
  const slideWidth = presentation.width || 1280;
  const slideHeight = presentation.height || 720;
  const direction = transitionDirection === 'next' ? 1 : -1;
  const getSlideStyle = (isCurrent: boolean): React.CSSProperties => {
    if (!isTransitioning) {
      return isCurrent
        ? { opacity: 1, transform: 'translateX(0) scale(1) rotateY(0deg)', zIndex: 2 }
        : { opacity: 0, transform: 'none', zIndex: 1 };
    }
    if (isCurrent) {
      switch (transition) {
        case 'fade':
          return { opacity: 1, transform: 'none', zIndex: 2 };
        case 'slide':
          return { opacity: 1, transform: 'translateX(0)', zIndex: 2 };
        case 'zoom':
          return { opacity: 1, transform: 'scale(1)', zIndex: 2 };
        case 'flip':
          return { opacity: 1, transform: 'rotateY(0deg)', zIndex: 2 };
        default:
          return { opacity: 1, transform: 'none', zIndex: 2 };
      }
    } else {
      switch (transition) {
        case 'fade':
          return { opacity: 0, transform: 'none', zIndex: 1 };
        case 'slide':
          return { opacity: 0, transform: `translateX(${direction * -100}px)`, zIndex: 1 };
        case 'zoom':
          return { opacity: 0, transform: 'scale(1.05)', zIndex: 1 };
        case 'flip':
          return { opacity: 0, transform: `rotateY(${direction * -15}deg)`, zIndex: 1 };
        default:
          return { opacity: 0, transform: 'none', zIndex: 1 };
      }
    }
  };
  const getEnteringStyle = (): React.CSSProperties => {
    if (!isTransitioning) return { opacity: 0, transform: 'none' };
    switch (transition) {
      case 'fade':
        return { opacity: 0, transform: 'none' };
      case 'slide':
        return { opacity: 0, transform: `translateX(${direction * 100}px)` };
      case 'zoom':
        return { opacity: 0, transform: 'scale(0.9)' };
      case 'flip':
        return { opacity: 0, transform: `rotateY(${direction * 15}deg)` };
      default:
        return { opacity: 0, transform: 'none' };
    }
  };
  return (
    <div
      className="min-h-screen bg-slate-900 flex items-center justify-center relative overflow-hidden"
      style={{ perspective: '2000px' }}
    >
      <div className="w-full max-w-6xl mx-4 flex justify-center">
        <div
          className="relative"
          style={{
            aspectRatio: `${slideWidth} / ${slideHeight}`,
            width: '100%',
          }}
        >
          {isTransitioning && prevIndex !== currentIndex && (
            <div
              className="absolute inset-0 bg-white rounded-lg shadow-2xl overflow-hidden"
              style={{
                transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
                ...getSlideStyle(false),
              }}
            >
              <div className="w-full h-full" dangerouslySetInnerHTML={safeHtml(prevSlide.html)} />
            </div>
          )}

          <div
            className="absolute inset-0 bg-white rounded-lg shadow-2xl overflow-hidden"
            style={{
              transition: isTransitioning ? 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
              ...(isTransitioning ? getEnteringStyle() : getSlideStyle(true)),
            }}
          >
            <div className="w-full h-full" dangerouslySetInnerHTML={safeHtml(currentSlide.html)} />
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 z-50 opacity-60 hover:opacity-100 transition-opacity duration-300">
        <button
          onClick={() => goToSlide(Math.max(currentIndex - 1, 0), 'prev')}
          disabled={currentIndex === 0 || isTransitioning}
          className="p-3 bg-black/40 backdrop-blur-sm text-white rounded-full hover:bg-black/60 disabled:opacity-30 transition-all"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="text-white/90 text-sm min-w-[80px] text-center px-3 py-1.5 bg-black/40 backdrop-blur-sm rounded-full">
          {currentIndex + 1} / {presentation.slides.length}
        </span>
        <button
          onClick={() =>
            goToSlide(Math.min(currentIndex + 1, presentation.slides.length - 1), 'next')
          }
          disabled={currentIndex === presentation.slides.length - 1 || isTransitioning}
          className="p-3 bg-black/40 backdrop-blur-sm text-white rounded-full hover:bg-black/60 disabled:opacity-30 transition-all"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      <div className="absolute top-6 right-6 flex items-center gap-2 z-50 opacity-60 hover:opacity-100 transition-opacity duration-300">
        <button
          onClick={() => window.history.back()}
          className="p-2 bg-black/40 backdrop-blur-sm text-white rounded-lg hover:bg-black/60 transition-all"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-50 opacity-60 hover:opacity-100 transition-opacity duration-300">
        {presentation.slides.map((_, i) => (
          <button
            key={i}
            onClick={() => goToSlide(i, i > currentIndex ? 'next' : 'prev')}
            className={`w-2 h-2 rounded-full transition-all ${i === currentIndex ? 'bg-white w-3' : 'bg-white/30 hover:bg-white/50'}`}
          />
        ))}
      </div>
    </div>
  );
}
