'use client'

import { useState } from "react";
import SearchBox from './components/Search'
import ChatBox from './components/Chat'

type Tab = "search" | "chat";

export default function Home() {
  const [tab, setTab] = useState<Tab>("search");

  return (
    <main className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">FredyMail Pro</h1>

        <div className="w-full mb-4 flex border-b border-gray-700">
          {(["search", "chat"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t
                  ? "border-b-2 border-blue-500 text-blue-400"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {t === "search" ? "Arama" : "Sohbet"}
            </button>
          ))}
        </div>

        {tab === "search" ? <SearchBox /> : <ChatBox />}
      </div>
    </main>
  )
}
