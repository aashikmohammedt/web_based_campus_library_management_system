export default function StatCards({ stats }) {
  return (
    <section className="stats-grid">
      {stats.map((stat) => (
        <div key={stat.label} className={`stat-card tone-${stat.tone || "blue"}`}>
          <div className="stat-icon">{stat.short}</div>
          <div>
            <h3>{stat.value}</h3>
            <p>{stat.label}</p>
          </div>
        </div>
      ))}
    </section>
  );
}