import { useEffect, useState } from "react";
import { errorMessage, listTools, type ToolInfo } from "./api";
import { toolComponents } from "./tools";

export default function App() {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTools()
      .then((all) => {
        const available = all.filter((tool) => toolComponents[tool.id]);
        setTools(available);
        setActiveId(available[0]?.id ?? null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const ActiveTool = activeId ? toolComponents[activeId] : null;

  return (
    <div className="flex h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
        <h1 className="mb-6 px-3 text-lg font-bold">Hack Life Tools</h1>
        <nav className="flex flex-col gap-1">
          {tools?.map((tool) => (
            <button
              key={tool.id}
              type="button"
              title={tool.description}
              onClick={() => setActiveId(tool.id)}
              className={`rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                tool.id === activeId
                  ? "bg-gray-200 dark:bg-gray-800"
                  : "hover:bg-gray-100 dark:hover:bg-gray-800/60"
              }`}
            >
              {tool.name}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
        {ActiveTool && <ActiveTool key={activeId} />}
        {tools?.length === 0 && <p className="text-gray-500">No tools found.</p>}
      </main>
    </div>
  );
}
