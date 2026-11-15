"use client";
import {useEffect,useState} from "react";
import {useAdminData} from "@/components/admin/use-admin-data";
import {api} from "@/lib/client";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card,CardContent} from "@/components/ui/card";
import {requirements} from "@/lib/driver/catalogue";
import {BadgeCheck, Eye, EyeOff} from "lucide-react";

type Document={id:string;type:string;state:string;scanState:string;mime:string;bytes:number;expiresAt:string|null;reviewReason:string|null;filePurgeAt:string|null;filePurgedAt:string|null};
type Application={id:string;version:number;status:string;reviewReason:string|null;driver:{name:string;phone:string;plate:string;capacity:number};documents:Document[]};

const DOC_STATE_STYLES: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-900 border-emerald-200",
  pending_review: "bg-amber-100 text-amber-900 border-amber-200",
  rejected: "bg-red-100 text-red-900 border-red-200",
};

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Inline evidence preview. The bytes endpoint forces a download and audits every
 * read, so previews load only on demand: fetch once as a blob and render images /
 * PDFs in place. Anything else keeps the download link.
 */
function DocumentPreview({id, mime}: {id: string; mime: string}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (url) return;
    setBusy(true); setFailed(false);
    try {
      const res = await fetch(`/api/admin/driver-onboarding/documents/${id}`, {credentials: "same-origin"});
      if (!res.ok) throw new Error("read failed");
      setUrl(URL.createObjectURL(await res.blob()));
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }

  return <div className="space-y-2">
    <Button size="sm" variant="outline" onClick={toggle} aria-expanded={open}>
      {open ? <><EyeOff className="h-3.5 w-3.5" /> Hide preview</> : <><Eye className="h-3.5 w-3.5" /> Preview document</>}
    </Button>
    {open && (busy ? <p className="text-sm text-muted-foreground">Loading preview…</p>
      : failed ? <p className="text-sm text-muted-foreground">Preview could not be loaded — use the download link instead.</p>
      : url ? (mime.startsWith("image/")
          ? // Plain <img>: the source is a short-lived blob URL, not an optimizable asset.
            <img src={url} alt="Document preview" className="max-h-[28rem] w-full rounded-lg border bg-muted/40 object-contain" />
          : mime === "application/pdf"
            ? <iframe src={url} title="Document preview" className="h-[28rem] w-full rounded-lg border bg-white" />
            : <p className="text-sm text-muted-foreground">No inline preview for this file type — use the download link instead.</p>)
      : null)}
  </div>;
}
function ReviewCard({row,refresh}:{row:Application;refresh:()=>Promise<unknown>}) {
  const [busy,setBusy]=useState(false),[reason,setReason]=useState(""),[error,setError]=useState("");
  async function action(action:string,documentId?:string) {
    setBusy(true);setError("");
    try {await api("/api/admin/driver-onboarding",{method:"POST",body:{applicationId:row.id,expectedVersion:row.version,action,documentId,reason}});await refresh();setReason("");}
    catch(e){setError(e instanceof Error?e.message:"Unable to save review.");}finally{setBusy(false);}
  }
  async function scan(id:string) {
    setBusy(true);setError("");try{await api(`/api/admin/driver-onboarding/documents/${id}`,{method:"POST"});await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Scanning unavailable.");}finally{setBusy(false);}
  }
  return <Card><CardContent className="space-y-4 p-4 sm:p-5">
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{row.driver.name}</h2>
        {row.status === "approved" && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-600">
            <BadgeCheck className="h-4 w-4 fill-sky-500 text-white" /> Verified
          </span>
        )}
        <Badge variant="outline">{row.status.replaceAll("_", " ")}</Badge>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">{row.driver.plate||"Vehicle details pending"} · {row.driver.capacity} seats · {row.driver.phone}</p>
    </div>
    {row.reviewReason&&<p className="text-sm">Last review: {row.reviewReason}</p>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <label className="block text-sm">Reason or reviewer note<textarea className="mt-1 min-h-20 w-full rounded-lg border bg-background p-3" value={reason} onChange={e=>setReason(e.target.value.slice(0,500))} disabled={busy}/></label>
    <div className="grid gap-3 lg:grid-cols-2">{row.documents.map(d=>{
      const requirement = requirements.find(r => r.id === d.type);
      const pending=d.state==="pending_review";
      const reviewing=pending&&["submitted","approved"].includes(row.status);
      const fileAvailable=!d.filePurgedAt&&(!d.filePurgeAt||Date.parse(d.filePurgeAt)>Date.now());
      return <div key={d.id} className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{requirement?.title ?? d.type.replaceAll("_", " ")}</p>
        <Badge variant="outline" className={DOC_STATE_STYLES[d.state] || ""}>{d.state.replaceAll("_", " ")}</Badge>
        {!requirement && <span className="text-xs font-normal text-muted-foreground">Previous checklist</span>}
      </div>
      <p className="text-xs text-muted-foreground">Scan: {d.scanState} · Expiry: {d.expiresAt?.slice(0,10)||"Reviewer must verify applicability"}</p>
      {d.reviewReason&&<p className="text-sm">{d.reviewReason}</p>}
      {fileAvailable ? <>
          <DocumentPreview id={d.id} mime={d.mime} />
          <a href={`/api/admin/driver-onboarding/documents/${d.id}`} className="block text-sm underline">Download private evidence{formatSize(d.bytes) ? ` (${formatSize(d.bytes)})` : ""}</a>
        </> :
        <p className="text-sm text-muted-foreground">{d.filePurgedAt ? "File deleted · verification record retained" : "File retention period ended"}</p>}
      {pending&&fileAvailable&&<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={()=>scan(d.id)}>Run security scan</Button>
        <Button size="sm" disabled={busy||!reviewing||!["clean","clean_demo"].includes(d.scanState)} onClick={()=>action("approve_document",d.id)}>Approve document</Button>
        <Button size="sm" variant="outline" disabled={busy||!reviewing||reason.trim().length<5} onClick={()=>action("reject_document",d.id)}>Reject document</Button></div>}
    </div>})}</div>
    {!row.documents.length&&<p className="text-sm text-muted-foreground">No submitted evidence yet.</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy||row.status!=="submitted"} onClick={()=>action("approve")}>Approve application</Button>
      <Button variant="outline" disabled={busy||reason.trim().length<5} onClick={()=>action("needs_changes")}>Request changes</Button>
      <Button variant="outline" disabled={busy||reason.trim().length<5} onClick={()=>action("suspend")}>Suspend new work</Button></div>
    <p className="text-xs text-muted-foreground">The server checks every required document before approval. Suspension blocks new work; dispatch must handle active-trip safety separately.</p>
  </CardContent></Card>;
}
// Queue arrangement: work that needs a reviewer first, then in-progress
// applications, then the verified roster, then suspended. The API already
// returns newest activity first; the grouping is stable within each section.
const QUEUE_GROUPS: {key: string; title: string; statuses: string[]}[] = [
  {key: "awaiting", title: "Awaiting review", statuses: ["submitted"]},
  {key: "progress", title: "In progress", statuses: ["draft", "changes_requested"]},
  {key: "approved", title: "Approved — verified drivers", statuses: ["approved"]},
  {key: "suspended", title: "Suspended", statuses: ["suspended"]},
];

export default function DriverOnboardingPage() {
  const {data,error,refresh}=useAdminData<{applications:Application[]}>("/api/admin/driver-onboarding");
  const applications = data?.applications ?? [];
  const grouped = QUEUE_GROUPS.map(g => ({...g, rows: applications.filter(a => g.statuses.includes(a.status))}));
  const ungrouped = applications.filter(a => !QUEUE_GROUPS.some(g => g.statuses.includes(a.status)));
  if (ungrouped.length) grouped.push({key: "other", title: "Other", statuses: [], rows: ungrouped});
  const awaiting = grouped.find(g => g.key === "awaiting")?.rows.length ?? 0;

  return <div className="space-y-5">
    <div>
      <h1 className="text-2xl font-bold">Driver onboarding</h1>
      <p className="mt-1 text-sm text-muted-foreground">Review private evidence, give actionable reasons and approve eligible drivers.</p>
      {data && <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline" className={awaiting ? "bg-amber-100 text-amber-900 border-amber-200" : ""}>{awaiting} awaiting review</Badge>
        {grouped.filter(g => g.key !== "awaiting").map(g => <Badge key={g.key} variant="outline">{g.rows.length} {g.title.toLowerCase()}</Badge>)}
      </div>}
    </div>
    {error&&<p role="alert">{error}</p>}{!data&&!error&&<p>Loading applications…</p>}
    {grouped.map(g => g.rows.length > 0 && (
      <section key={g.key} className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.title} · {g.rows.length}</h2>
        {g.rows.map(row => <ReviewCard key={row.id} row={row} refresh={refresh} />)}
      </section>
    ))}
    {data?.applications.length===0&&<p>No driver applications yet.</p>}
  </div>;
}
