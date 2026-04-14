import { useState } from "react";

interface EmailResult {
  id: string;
  subject: string;
  sender: string;
  date: string;
}

export default function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EmailResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setSearched(false);

    try {
      const res = await fetch("http://localhost:7700/indexes/emails/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setResults(data.hits ?? []);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-xl mx-auto">
      <form onSubmit={handleSearch} className="flex gap-2 mb-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Mail ara..."
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Aranıyor..." : "Ara"}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600 mb-2">{error}</p>
      )}

      {searched && results.length === 0 && !error && (
        <p className="text-sm text-gray-500">Sonuç yok</p>
      )}

      {results.length > 0 && (
        <ul className="divide-y divide-gray-200 rounded border border-gray-200">
          {results.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-0.5 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <span className="text-sm font-medium text-gray-900">{item.subject}</span>
              <span className="text-xs text-gray-500">{item.sender}</span>
              <span className="text-xs text-gray-400">{item.date}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
