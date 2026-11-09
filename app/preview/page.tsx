import { ThemeControl } from "@/components/theme-control";
import { RepositoryMap } from "@/components/repository-map";
import { previewAnalysis } from "@/data/preview-analysis.mts";

/** Renders the offline explorer from the pinned parser fixture. */
export default function PreviewPage() {
  return (
    <div className="flex h-dvh flex-col overflow-x-auto">
      <header className="flex h-9 min-w-192 shrink-0 items-center gap-3 border-b border-line px-3">
        <span className="font-semibold tracking-tight">Cartograph</span>
        <span className="text-muted">Preview</span>
        <div className="ml-auto">
          <ThemeControl />
        </div>
      </header>
      <main className="grid min-h-0 min-w-192 flex-1 grid-cols-[11rem_minmax(19rem,1fr)_clamp(18rem,32vw,28rem)]">
        <RepositoryMap analysis={previewAnalysis} name="excalidraw / packages" examples={[
          "excalidraw/components/App.tsx",
          "common/src/index.ts",
          "element/src/Scene.ts",
        ]} />
      </main>
    </div>
  );
}
