export default function QuickSummaryStrip({ items = [] }) {
  if (!items.length) return null;

  return (
    <section className="quick-summary-strip">
      {items.map((item) => (
        <div className="quick-summary-pill" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </section>
  );
}