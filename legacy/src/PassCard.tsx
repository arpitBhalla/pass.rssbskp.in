import { Fragment, useMemo } from 'react';
import type { Pass, PrintSettings, Zone } from './types';
import { barcodePath, barcodeBits } from './lib/barcode';

const HEADER: Record<Zone, string> = {
  inside: 'पंडाल के अंदर',
  outside: 'पंडाल से बाहर',
};

const QUIET = 10; // blank modules either side so scanners can find the code

function Barcode({ value }: { value: string }) {
  const bits = useMemo(() => barcodeBits(value), [value]);
  return (
    <svg
      className="barcode"
      viewBox={`0 0 ${bits.length + 2 * QUIET} 10`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Barcode ${value}`}
    >
      <path d={barcodePath(bits, QUIET)} />
    </svg>
  );
}

/**
 * One printed pass. Passes with a name show the sewadar's details;
 * blank passes get empty lines to fill in by hand.
 */
export function PassCard({ p, s }: { p: Pass; s: PrintSettings }) {
  const blank = !p.name;
  const fields: [string, string][] = [
    ['Dept', p.dept],
    ['Area', p.area],
    ['Phone', p.phone],
    ['Valid till', s.validTill],
  ];
  const sign = (
    <div className="sign">
      {s.signature ? <img src={s.signature} alt="" /> : <div className="sign-space" />}
      <span>Auth Sign.</span>
    </div>
  );
  const code = (
    <div className="code">
      <Barcode value={p.serial} />
      <span>{p.serial}</span>
    </div>
  );

  return (
    <div className={`card ${s.zone}`}>
      <div className="card-head" lang="hi">{HEADER[s.zone]}</div>
      <div className="card-body">
        <div className="watermark" aria-hidden="true"><span>RS</span><span>SB</span></div>
        {s.event && <div className="event">{s.event}</div>}
        <div className="title">{p.type} Pass</div>
        {!blank && <div className="name">{p.name}</div>}
        <dl className="fields">
          {fields.map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}:</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </dl>
        {blank && <div className="icons" aria-hidden="true">{p.type === 'Bike' ? '🏍️' : '📱 💻'}</div>}
        <div className="card-foot">{blank ? <>{sign}{code}</> : <>{code}{sign}</>}</div>
      </div>
    </div>
  );
}
