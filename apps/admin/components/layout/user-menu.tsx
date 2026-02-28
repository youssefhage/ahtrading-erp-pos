"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Settings, User } from "lucide-react";

import { clearSession, apiPost, getCompanyId, apiGet } from "@/lib/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState<string>("");

  useEffect(() => {
    // Try cached name first, then resolve from API
    const cached = window.localStorage.getItem("ahtrading.companyName");
    if (cached) {
      setCompanyName(cached);
      return;
    }
    const id = getCompanyId();
    if (!id) return;
    apiGet<{ companies: Array<{ id: string; name: string }> }>("/companies")
      .then((res) => {
        const match = res.companies?.find((c) => c.id === id);
        if (match) {
          setCompanyName(match.name);
          window.localStorage.setItem("ahtrading.companyName", match.name);
        }
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    try {
      await apiPost("/auth/logout", {});
    } catch {
      // Ignore logout errors
    }
    clearSession();
    router.push("/login");
  };

  const handleSwitchCompany = () => {
    router.push("/company/select");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 rounded-full p-0">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
              {companyName ? companyName[0].toUpperCase() : "U"}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">{companyName || "User"}</p>
            <p className="text-xs text-muted-foreground">Admin Portal</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSwitchCompany}>
          <User className="mr-2 h-4 w-4" />
          Switch Company
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/system/config")}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Log Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
