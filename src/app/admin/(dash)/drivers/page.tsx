"use client";

import { useState } from "react";
import { useAdminData } from "@/components/admin/use-admin-data";
import { MoneyStatusBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/client";
import { ksh } from "@/lib/format";
import { AlertTriangle, BadgeCheck, Plus, ShieldAlert, UserPlus, Users } from "lucide-react";

interface DriverRow {
  id: string;
  name: string;
  phone: string;
  mpesaNumber: string;
  mpesaAtRisk: boolean;
  plate: string;
  cabType: string;
  capacity: number;
  status: string;
  verified: boolean;
  rating: number;
  completedTrips: number;
  earnings: { lifetimeGross: number; queued: number; paid: number; failed: number };
  recentPayouts: { id: string; gross: number; commission: number; net: number; status: string; initiatedAt: string }[];
}

const EMPTY_FORM = { name: "", phone: "", mpesaNumber: "", plate: "", cabType: "14-seater matatu", capacity: "13" };

export default function AdminDrivers() {
  const { toast } = useToast();
  const { data, refresh } = useAdminData<{ drivers: DriverRow[] }>("/api/admin/drivers");
  const [addOpen, setAddOpen] = useState(false);
  const [edit, setEdit] = useState<DriverRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  function openAdd() {
    setForm(EMPTY_FORM);
    setAddOpen(true);
  }

  function openEdit(d: DriverRow) {
    setForm({ name: d.name, phone: d.phone, mpesaNumber: d.mpesaNumber, plate: d.plate, cabType: d.cabType, capacity: String(d.capacity) });
    setEdit(d);
  }

  async function save() {
    setBusy(true);
    try {
      if (edit) {
        await api(`/api/admin/drivers/${edit.id}`, { method: "PATCH", body: form });
        toast({ title: "Driver updated" });
      } else {
        await api("/api/admin/drivers", { body: form });
        toast({ title: "Driver added", description: "They'll join the auto-allocation pool immediately." });
      }
      setAddOpen(false);
      setEdit(null);
      refresh();
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(d: DriverRow, status: string) {
    try {
      await api(`/api/admin/drivers/${d.id}`, { method: "PATCH", body: { status } });
      toast({ title: `${d.name} → ${status}` });
      refresh();
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    }
  }

  const statusStyles: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-900 border-emerald-200",
    inactive: "bg-stone-100 text-stone-600 border-stone-200",
    suspended: "bg-red-100 text-red-900 border-red-200",
  };

  // Verified (compliance-approved) drivers first, then by status, then name.
  const statusRank: Record<string, number> = { active: 0, inactive: 1, suspended: 2 };
  const sortedDrivers = [...(data?.drivers || [])].sort((a, b) =>
    Number(b.verified) - Number(a.verified) ||
    (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3) ||
    a.name.localeCompare(b.name)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Drivers</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Everything driver-related lives here: roster, vehicles, M-Pesa payout numbers and
            per-driver earnings. Drivers have no UI in Mi-Reli — the driver app is a separate build
            that consumes the same records.
          </p>
        </div>
        <Button onClick={openAdd}>
          <UserPlus className="h-4 w-4" /> Add driver
        </Button>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {sortedDrivers.map((d) => (
          <Card key={d.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{d.name}</span>
                    {d.verified && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-600">
                        <BadgeCheck className="h-4 w-4 fill-sky-500 text-white" /> Verified
                      </span>
                    )}
                    <Badge variant="outline" className={statusStyles[d.status] || ""}>{d.status}</Badge>
                    {d.mpesaAtRisk && (
                      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-900">
                        <ShieldAlert className="h-3 w-3" /> M-Pesa number fails B2C
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {d.phone} · {d.cabType} · {d.plate} · M-Pesa {d.mpesaNumber}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.completedTrips} completed trips · rating {d.rating.toFixed(1)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-right text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Queued</p>
                    <p className="font-semibold text-amber-700">{ksh(d.earnings.queued)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Paid</p>
                    <p className="font-semibold text-emerald-700">{ksh(d.earnings.paid)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Failed</p>
                    <p className="font-semibold text-red-700">{ksh(d.earnings.failed)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Gross</p>
                    <p className="font-semibold">{ksh(d.earnings.lifetimeGross)}</p>
                  </div>
                </div>
              </div>

              {d.recentPayouts.length > 0 && (
                <div className="mt-3 border-t pt-2">
                  <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Recent payouts</p>
                  <div className="flex flex-wrap gap-2">
                    {d.recentPayouts.map((p) => (
                      <span key={p.id} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                        <MoneyStatusBadge status={p.status} /> {ksh(p.net)} <span className="text-muted-foreground">(comm {ksh(p.commission)})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(d)}>
                  Edit
                </Button>
                {d.status === "active" ? (
                  <Button size="sm" variant="ghost" onClick={() => setStatus(d, "suspended")}>
                    Suspend
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setStatus(d, "active")}>
                    Reactivate
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {data && data.drivers.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No drivers yet — add your first.</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={addOpen || !!edit} onOpenChange={(v) => { if (!v) { setAddOpen(false); setEdit(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{edit ? `Edit ${edit.name}` : "Add a driver"}</DialogTitle>
            <DialogDescription>
              The M-Pesa number receives all payouts (B2C). Double-check it — a bad number fails the
              payout and flags for review rather than retrying blindly.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-name">Full name</Label>
              <Input id="d-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="d-phone">Phone</Label>
                <Input id="d-phone" placeholder="+2547XXXXXXXX" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={!!edit} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-mpesa">M-Pesa payout number</Label>
                <Input id="d-mpesa" placeholder="+2547XXXXXXXX" value={form.mpesaNumber} onChange={(e) => setForm({ ...form, mpesaNumber: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="d-plate">Vehicle plate</Label>
                <Input id="d-plate" placeholder="KDA 471X" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-cap">Capacity (seats)</Label>
                <Input id="d-cap" inputMode="numeric" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value.replace(/\D/g, "") })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Cab type</Label>
              <Select value={form.cabType} onValueChange={(v) => setForm({ ...form, cabType: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="14-seater matatu">14-seater matatu</SelectItem>
                  <SelectItem value="Noah (7-seater)">Noah (7-seater)</SelectItem>
                  <SelectItem value="Saloon car">Saloon car</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={save} disabled={busy || !form.name || !form.phone || !form.plate}>
              <Plus className="h-4 w-4" /> {edit ? "Save changes" : "Add driver"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
