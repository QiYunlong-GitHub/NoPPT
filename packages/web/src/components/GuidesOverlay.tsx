import type { GuideLine } from '@/utils/SmartGuides';

interface GuidesOverlayProps {
  guides: GuideLine[];
}

const GUIDE_COLOR = '#0ea5e9';

export function GuidesOverlay({ guides }: GuidesOverlayProps) {
  if (!guides || guides.length === 0) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10000, overflow: 'visible' }}
    >
      {guides.map((guide, index) => {
        if (guide.type === 'vertical') {
          const top = Math.min(guide.start, guide.end);
          const height = Math.abs(guide.end - guide.start);
          return (
            <div
              key={`v-${index}`}
              style={{
                position: 'absolute',
                left: `${guide.position}px`,
                top: `${top}px`,
                width: '1px',
                height: `${height}px`,
                backgroundColor: GUIDE_COLOR,
              }}
            />
          );
        }
        const left = Math.min(guide.start, guide.end);
        const width = Math.abs(guide.end - guide.start);
        return (
          <div
            key={`h-${index}`}
            style={{
              position: 'absolute',
              left: `${left}px`,
              top: `${guide.position}px`,
              width: `${width}px`,
              height: '1px',
              backgroundColor: GUIDE_COLOR,
            }}
          />
        );
      })}
    </div>
  );
}
