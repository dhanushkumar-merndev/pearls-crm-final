"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { callFunction, rpc } from "@/lib/rpc";
import { uploadPrivateFile } from "@/lib/upload";
import { jobsFor, onQueueChange, runQueue, type QueueDeps, type UploadJob } from "@/lib/upload-queue";

/** The real server behind the queue. */
export function browserQueueDeps(onSaved: (patientId: string) => void): QueueDeps {
  return {
    online: () => navigator.onLine,
    now: () => Date.now(),
    findDuplicate: (patientId, sha256) =>
      rpc<{ title: string; doc_date: string } | null>("find_duplicate_document", { p_patient_id: patientId, p_sha256: sha256 }),
    upload: async (file, purpose, patientId, clientId) =>
      (await uploadPrivateFile(file, purpose, { patient_id: patientId }, clientId)).fileId,
    createDocument: async (doc, clientId) => {
      await rpc("create_document", { p_doc: doc, p_client_id: clientId });
      onSaved(String(doc.patient_id));
    },
    discard: async (fileIds) => void (await callFunction("files-sign", { op: "discard", file_ids: fileIds })),
    closeScan: async (sessionId) => void (await rpc("close_phone_scan", { p_session_id: sessionId })),
  };
}

/**
 * Runs the upload queue for the whole signed-in app (mounted once in the shell): on
 * load, whenever a scan is saved, when the browser comes back online, and when the next
 * retry is due. One tab at a time (Web Locks), so tabs never upload the same scan twice.
 */
export function UploadQueueRunner() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    let stopped = false;
    let running = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deps = browserQueueDeps((patientId) => {
      void queryClient.invalidateQueries({ queryKey: ["documents", patientId] });
      void queryClient.invalidateQueries({ queryKey: ["patient_header", patientId] });
      void queryClient.invalidateQueries({ queryKey: ["patient_timeline", patientId] });
    });

    const run = async (force = false) => {
      if (stopped) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        const exec = () => runQueue(deps, { force });
        const next = navigator.locks ? await navigator.locks.request("pearl-upload-queue", exec) : await exec();
        clearTimeout(timer);
        if (next !== null && !stopped) timer = setTimeout(() => void run(), Math.max(1000, next - Date.now()));
      } catch {
        // IndexedDB blocked or closing: the next change or "online" event tries again
      } finally {
        running = false;
        if (again) {
          again = false;
          void run();
        }
      }
    };

    const onOnline = () => void run(true);
    window.addEventListener("online", onOnline);
    const off = onQueueChange(() => void run());
    void run();
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      off();
    };
  }, [queryClient]);
  return null;
}

/** Scans of one patient still waiting in this browser (live). */
export function useQueuedJobs(patientId: string): UploadJob[] {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    let alive = true;
    const load = () =>
      void jobsFor(patientId)
        .then((j) => alive && setJobs(j))
        .catch(() => alive && setJobs([]));
    load();
    const off = onQueueChange(load);
    return () => {
      alive = false;
      off();
    };
  }, [patientId]);
  return jobs;
}
