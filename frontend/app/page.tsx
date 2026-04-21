import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-6">
        <h1 className="text-4xl font-black tracking-[0.25em] text-white">APEX-Q</h1>
        <p className="text-slate-400 text-sm">Quantitative Trading Terminal — Elliott Wave Pro</p>

        <div className="grid grid-cols-1 gap-3 mt-12">
          <Link
            href="/elliott"
            className="block bg-apex-card border border-apex-border rounded-xl p-6 hover:border-apex-blue transition-colors"
          >
            <div className="text-xs text-apex-blue font-bold tracking-widest mb-2">
              ELLIOTT WAVE PRO
            </div>
            <div className="text-white font-bold">Wave Scanner & Trade Setup</div>
            <div className="text-xs text-slate-500 mt-1">
              A-B-C tepki, Fib hedefleri, MTF, Alt senaryo
            </div>
          </Link>
        </div>

        <div className="text-[10px] text-slate-600 mt-8 tracking-widest">
          v2.0 • {new Date().getFullYear()} APEX-Q
        </div>
      </div>
    </main>
  );
}
