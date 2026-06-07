export default function DepartmentGrid({
  departments = [],
  selectedDepartment,
  onSelectDepartment,
}) {
  if (!departments.length) return null;

  return (
    <section className="department-grid-section">
      <div className="section-head">
        <h2>Browse by Department</h2>
      </div>

      <div className="department-grid">
        {departments.map((department) => {
          const isActive = selectedDepartment === department;

          return (
            <button
              key={department}
              type="button"
              className={`department-card ${isActive ? "active" : ""}`}
              onClick={() => onSelectDepartment?.(department)}
            >
              <span className="department-card-name">{department}</span>
            </button>
          );
        })}
        
      </div>
    </section>
  );
}