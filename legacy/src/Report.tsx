import { BY_LABEL, type Report as ReportData, type ReportLine } from './lib/report';

/** Pass counts grouped by Area then Dept (or the other way round), with subtotals and a grand total. */
export function Report({ report, caption }: { report: ReportData; caption: string }) {
  const { by, groups, total } = report;
  const sub = by === 'area' ? 'dept' : 'area';
  const nums = (l: ReportLine) => (
    <>
      <td className="num">{l.mobile}</td>
      <td className="num">{l.bike}</td>
      <td className="num"><b>{l.total}</b></td>
    </>
  );

  return (
    <div className="report">
      <h2>Pass report — by {BY_LABEL[by]}, then {BY_LABEL[sub]}</h2>
      <p className="muted small">{caption}</p>
      {groups.length === 0 ? (
        <p className="note">No passes match the search / filters above.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{BY_LABEL[by]}</th><th>{BY_LABEL[sub]}</th>
              <th className="num">Mobile</th><th className="num">Bike</th><th className="num">Total</th>
              <th>Serial nos.</th><th>Incharges</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.label}>
              <tr className="group">
                <td colSpan={2}>{g.label}</td>
                {nums(g)}
                <td colSpan={2} className="muted small">
                  {g.lines.length} {g.lines.length === 1 ? BY_LABEL[sub].toLowerCase() : `${BY_LABEL[sub].toLowerCase()}s`}
                </td>
              </tr>
              {g.lines.map((l) => (
                <tr key={l.label}>
                  <td />
                  <td>{l.label}</td>
                  {nums(l)}
                  <td className="wrap mono">{l.serials}</td>
                  <td className="wrap">{l.incharges}</td>
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr>
              <td colSpan={2}>Total</td>
              {nums(total)}
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
