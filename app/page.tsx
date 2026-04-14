'use client'

import SearchBox from './components/Search'

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">🔍 FredyMail Pro</h1>
        <SearchBox />
      </div>
    </main>
  )
}