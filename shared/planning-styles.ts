export const PLANNING_CSS = `
.cost-details,.journey-details{min-width:0;overflow-wrap:anywhere}
.cost-details .revision-impact{margin:14px 0}.cost-list{margin:16px 0}
.cost-list article{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 20px;padding:15px 0;border-bottom:1px solid #e1e7dc;break-inside:avoid}
.cost-list article>div{display:grid;gap:6px}.cost-list strong{font-size:13px;font-weight:500}.cost-list span,.cost-list p{font-size:11px;color:#73806b;line-height:1.7}.cost-list article>b{font-size:13px;font-weight:500;color:#3f614b}.cost-list p{grid-column:1/-1;margin:0}
.journey-details{margin:16px 0;padding:0 16px;border:1px solid #dce5d5;border-radius:10px;background:#f8faf5}.journey-details article{padding:14px 0}.journey-details article+article{border-top:1px solid #e1e7dc}.journey-details strong{font-size:12px}.journey-details p{font-size:12px;line-height:1.8;margin:6px 0}.journey-details small{font-size:10px;line-height:1.7;color:#73806b;display:block}
.repair-comparison{border:1px solid #d8e2d0;background:#f5f8f0;border-radius:12px;padding:18px;margin-bottom:20px}.repair-comparison>strong{font-size:14px}.repair-comparison .revision-impact{margin:14px 0}
.expense-breakdown{margin-bottom:22px}.expense-breakdown>summary{cursor:pointer;font-size:13px;padding:12px 0;color:#3d6148}
@media(max-width:600px){.cost-list article{grid-template-columns:minmax(0,1fr)}.cost-list article>b{font-size:12px}.repair-comparison{padding:14px}.journey-details{padding:0 12px}}
`;
