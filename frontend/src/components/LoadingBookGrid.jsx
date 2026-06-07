export default function LoadingBookGrid() {
  return (
    <div className="book-list">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="book-card skeleton-card" key={index}>
          <div className="skeleton-box skeleton-cover" />
          <div className="skeleton-box skeleton-line" />
          <div className="skeleton-box skeleton-line short" />
          <div className="skeleton-box skeleton-line" />
        </div>
      ))}
    </div>
  );
}