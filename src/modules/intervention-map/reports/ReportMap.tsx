// A report's map on screen, drawn as SVG from the same boundaries and projection as its PDF.
import { boundsOf, fitProjection, type Polygon } from './geo';

export interface ReportMapLayer {
  polygons: Polygon[];
  fill?: string;
  stroke?: string;
  width?: number;
}

interface ReportMapProps {
  label: string;
  focus: Polygon[];
  layers: ReportMapLayer[];
  points: { lat: number; lng: number; color: string }[];
}

const WIDTH = 600;
const HEIGHT = 380;

export function ReportMap({ label, focus, layers, points }: ReportMapProps) {
  const bounds = boundsOf(focus, points);
  if (!bounds) return null;
  const projection = fitProjection(bounds, { x: 0, y: 0, width: WIDTH, height: HEIGHT });
  const pathOf = (polygons: Polygon[]) =>
    polygons
      .map((polygon) =>
        polygon
          .map((ring) =>
            ring
              .map(([lng, lat], index) => {
                const [x, y] = projection.project(lng, lat);
                return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join('') + 'Z',
          )
          .join(''),
      )
      .join('');

  return (
    <svg className="report-map" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
      <rect width={WIDTH} height={HEIGHT} fill="#eef3f6" />
      {layers.map((layer, index) => (
        <path key={index} d={pathOf(layer.polygons)} fill={layer.fill ?? 'none'} stroke={layer.stroke ?? 'none'} strokeWidth={layer.width ?? 0.6} fillRule="evenodd" />
      ))}
      {points.map((point, index) => {
        const [x, y] = projection.project(point.lng, point.lat);
        return <circle key={index} cx={x} cy={y} r={4} fill={point.color} stroke="#ffffff" strokeWidth={1.2} />;
      })}
    </svg>
  );
}
