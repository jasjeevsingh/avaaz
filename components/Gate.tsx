"use client";
import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function Gate() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  async function submit() {
    setError(false);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        setError(true);
      }
    } catch (err) {
      console.error(err);
      setError(true);
    }
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle asChild className="text-3xl">
            <h1>Avaaz</h1>
          </CardTitle>
          <CardDescription>Enter the password from your retreat packet.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                autoFocus
                autoComplete="current-password"
                aria-invalid={error || undefined}
                aria-describedby={error ? "password-error" : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p id="password-error" role="alert" className="text-sm font-medium text-destructive">
                That password didn&apos;t work.
              </p>
            )}
            <Button type="submit" className="w-full">
              Enter
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
