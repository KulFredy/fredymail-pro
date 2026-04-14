'use client';

import { useState, useEffect, useCallback } from 'react';

interface EmailResult {
  id: string;
  subject: string;
  sender: string;
  date: string;
  preview?: string;
}

interface MeilisearchResponse {
  hits: EmailResult[];
  estimatedTotalHits: number;
}

export default function SearchBox() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EmailResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const searchEmails = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setHasSearched(true);

      const response = await fetch('http://localhost:7700/indexes/emails/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: searchQuery,
          limit: 10,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data: MeilisearchResponse = await response.json();
      setResults(data.hits || []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Arama sırasında bir hata oluştu'
      );
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      searchEmails(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, searchEmails]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('tr-TR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="w-full">
      {/* Search Input */}
      <div className="relative">
        <div className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2 shadow-sm transition-all duration-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 dark:border-gray-600 dark:bg-gray-800">
          <svg
            className="h-5 w-5 text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder="Mail ara..."
            className="w-full bg-transparent outline-none text-gray-900 placeholder-gray-500 dark:text-white dark:placeholder-gray-400"
          />
        </div>
      </div>

      {/* Results Container */}
      <div className="mt-4 space-y-2">
        {loading && (
          <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-blue-700 dark:border-blue-500 dark:border-t-blue-300" />
            <span className="text-sm font-medium">Aranıyor...</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-red-700 dark:bg-red-900/20 dark:text-red-400">
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {hasSearched && !loading && results.length === 0 && !error && (
          <div className="rounded-lg bg-gray-50 p-3 text-center text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            <p className="text-sm">Sonuç bulunamadı</p>
          </div>
        )}

        {/* Email Results */}
        {results.length > 0 && (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
            {results.map((email) => (
              <div
                key={email.id}
                className="border-b border-gray-200 p-4 transition-colors duration-150 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <div className="flex flex-col gap-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white line-clamp-1">
                    {email.subject || '(Başlık yok)'}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {email.sender}
                  </p>
                  {email.preview && (
                    <p className="text-sm text-gray-500 dark:text-gray-500 line-clamp-2 mt-1">
                      {email.preview}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {formatDate(email.date)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
