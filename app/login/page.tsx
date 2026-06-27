"use client";

import { useLayoutEffect, useState } from "react";
import { LoginForm } from "./login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BarChart3, Moon, Sun } from "lucide-react";

export default function LoginPage() {
  const [isDark, setIsDark] = useState(true);

  useLayoutEffect(() => {
    const saved = localStorage.getItem("login-theme");
    if (saved === "light") setIsDark(false);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("login-theme", next ? "dark" : "light");
  };

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="relative min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        {/* Theme toggle button */}
        <button
          onClick={toggleTheme}
          aria-label="Ganti tema"
          className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors
            border-slate-200 bg-white text-slate-600 hover:bg-slate-100
            dark:border-white/10 dark:bg-white/8 dark:text-slate-300 dark:hover:bg-white/12"
        >
          {isDark ? (
            <>
              <Sun className="h-3.5 w-3.5" />
              Mode Terang
            </>
          ) : (
            <>
              <Moon className="h-3.5 w-3.5" />
              Mode Gelap
            </>
          )}
        </button>

        {/* Background radial glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl dark:bg-emerald-500/10" />
          <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl dark:bg-emerald-500/5" />
        </div>

        <div className="relative w-full max-w-sm">
          {/* Logo / Brand */}
          <div className="mb-8 flex flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30">
              <BarChart3 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-center">
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Trade Marketing Monitor
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Campaign Budget Management System
              </p>
            </div>
          </div>

          <Card className="dark:border-white/8 dark:bg-slate-900/80 backdrop-blur-xl shadow-2xl">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Masuk ke akun Anda</CardTitle>
              <CardDescription>
                Gunakan email dan password kerja Anda
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LoginForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
