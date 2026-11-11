import type { Pass, PrintSettings } from './types';

/** Shrinks long names / depts so they still fit on one line. */
const FIT_CHARS = 16;
const fit = (v: string) => (v.length > FIT_CHARS ? { fontSize: `${Math.max(2.4, (3.9 * FIT_CHARS) / v.length)}mm` } : undefined);

/**
 * One printed Mobile pass, following the RSSB SKP template: blue for Pandal, orange for
 * Non Pandal (taken from the pass). Blank passes leave the details empty to fill in by hand.
 */
export function MobilePassCard({ p, s }: { p: Pass; s: PrintSettings }) {
  const fields: [string, string][] = [
    ['NAME', p.name],
    ['DEPT', p.dept],
    ['AREA', p.area],
    ['PHONE', p.phone],
  ];

  return (
    <div className={`mcard ${p.zone === 'Non Pandal' ? 'non-pandal' : 'pandal'}`}>
      <svg className="mcard-wave" viewBox="0 0 62 14" preserveAspectRatio="none" aria-hidden="true">
        <path className="band" d="M0 0H62V11.5C48 5.5 14 5.5 0 11.5Z" />
        <path className="stripe" d="M0 11.5C14 5.5 48 5.5 62 11.5V13C48 7 14 7 0 13Z" />
      </svg>
      <div className="mcard-logo" aria-hidden="true"><span>RS</span><span>SB</span></div>

      <div className="mcard-org">RSSB,SKP<small>ZONE-III</small></div>
      <div className="mcard-place">SIKANDERPUR - M.C.</div>
      <div className="mcard-kind">MOBILE PASS</div>
      <div className="mcard-zone">{p.zone.toUpperCase()}</div>

      <dl className="mcard-fields">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt><span>{label}</span><span>:</span></dt>
            <dd style={fit(value)}>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mcard-foot">
        <div className="mcard-sr">Sr. No. <b>{String(p.num).padStart(4, '0')}</b></div>
        <div className="mcard-sign">
          {s.signature ? <img src={s.signature} alt="" /> : <div className="sign-space" />}
          <span>Auth Signatory</span>
        </div>
      </div>
    </div>
  );
}
