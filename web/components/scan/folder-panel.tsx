"use client";

import { FolderOpen, FolderSearch, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { folderWatchSupported, pickFolder, regainAccess, rememberedFolder, watchFolder, type FolderHandle } from "@/lib/scan/folder-watch";

/** Scanner-folder watch (Chrome / Edge on a computer). New scans in the folder become pages. */
export function FolderPanel({ onFile }: { onFile: (file: File) => void }) {
  const t = useTranslations("scan");
  const [supported] = useState(folderWatchSupported);
  const [remembered, setRemembered] = useState<FolderHandle | null>(null);
  const [watching, setWatching] = useState<FolderHandle | null>(null);
  const [lost, setLost] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const onFileRef = useRef(onFile);
  useEffect(() => {
    onFileRef.current = onFile;
  }, [onFile]);

  useEffect(() => {
    if (supported) void rememberedFolder().then(setRemembered);
    return () => stop.current?.();
  }, [supported]);

  const begin = (dir: FolderHandle) => {
    stop.current?.();
    setLost(false);
    setWatching(dir);
    stop.current = watchFolder(
      dir,
      (file) => onFileRef.current(file),
      () => {
        setWatching(null);
        setLost(true);
      },
    );
  };

  if (!supported) {
    return <p className="rounded-xl border border-border bg-secondary p-3">{t("folderUnsupported")}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-secondary">{t("folderHowTo")}</p>
      {watching ? (
        <>
          <StatusBadge kind="good" label={t("folderWatching", { name: watching.name })} className="self-start" />
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              stop.current?.();
              stop.current = null;
              setWatching(null);
            }}
          >
            <Square aria-hidden />
            {t("folderStop")}
          </Button>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {remembered && (
            <Button
              variant="secondary"
              onClick={() => void regainAccess(remembered).then((ok) => (ok ? begin(remembered) : setLost(true))).catch(() => setLost(true))}
            >
              <FolderSearch aria-hidden />
              {t("folderWatchAgain", { name: remembered.name })}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() =>
              void pickFolder()
                .then((dir) => {
                  setRemembered(dir);
                  begin(dir);
                })
                .catch(() => {}) // closed the picker
            }
          >
            <FolderOpen aria-hidden />
            {t("folderChoose")}
          </Button>
        </div>
      )}
      {lost && <StatusBadge kind="serious" label={t("folderLost")} className="self-start" />}
    </div>
  );
}
