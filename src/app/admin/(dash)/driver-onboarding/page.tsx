"use client";
import {useState} from "react";
import {useAdminData} from "@/components/admin/use-admin-data";
import {api} from "@/lib/client";
import {Button} from "@/components/ui/button";
import {Card,CardContent} from "@/components/ui/card";
import {requirements} from "@/lib/driver/catalogue";

type Document={id:string;type:string;state:string;scanState:string;expiresAt:string|null;reviewReason:string|null;filePurgeAt:string|null;filePurgedAt:string|null};
type Application={id:string;version:number;status:string;reviewReason:string|null;driver:{name:string;phone:string;plate:string;capacity:number};documents:Document[]};
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
  return <Card><CardContent className="space-y-4 p-4">
    <div><h2 className="text-lg font-semibold">{row.driver.name}</h2><p className="text-sm text-muted-foreground">{row.driver.plate||"Vehicle details pending"} · {row.driver.capacity} seats · {row.driver.phone}</p><p className="text-sm font-medium">{row.status.replaceAll("_"," ")}</p></div>
    {row.reviewReason&&<p className="text-sm">Last review: {row.reviewReason}</p>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <label className="block text-sm">Reason or reviewer note<textarea className="mt-1 min-h-20 w-full rounded-lg border bg-background p-3" value={reason} onChange={e=>setReason(e.target.value.slice(0,500))} disabled={busy}/></label>
    <div className="space-y-3">{row.documents.map(d=>{
      const requirement = requirements.find(r => r.id === d.type);
      const pending=d.state==="pending_review";
      const reviewing=pending&&["submitted","approved"].includes(row.status);
      const fileAvailable=!d.filePurgedAt&&(!d.filePurgeAt||Date.parse(d.filePurgeAt)>Date.now());
      return <div key={d.id} className="space-y-2 rounded-xl border p-3">
      <p className="font-medium">{requirement?.title ?? d.type.replaceAll("_", " ")}
        {!requirement && <span className="ml-2 text-xs font-normal text-muted-foreground">Previous checklist</span>}
      </p>
      <p className="text-xs text-muted-foreground">Review: {d.state} · Scan: {d.scanState} · Expiry: {d.expiresAt?.slice(0,10)||"Reviewer must verify applicability"}</p>
      {d.reviewReason&&<p className="text-sm">{d.reviewReason}</p>}
      {fileAvailable ? <a href={`/api/admin/driver-onboarding/documents/${d.id}`} className="block text-sm underline">Download private evidence</a> :
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
export default function DriverOnboardingPage() {
  const {data,error,refresh}=useAdminData<{applications:Application[]}>("/api/admin/driver-onboarding");
  return <div className="space-y-4"><h1 className="text-2xl font-bold">Driver onboarding</h1><p className="text-sm text-muted-foreground">Review private evidence, give actionable reasons and approve eligible drivers.</p>
    {error&&<p role="alert">{error}</p>}{!data&&!error&&<p>Loading applications…</p>}
    {data?.applications.map(row=><ReviewCard key={row.id} row={row} refresh={refresh}/>)}
    {data?.applications.length===0&&<p>No driver applications yet.</p>}
  </div>;
}
