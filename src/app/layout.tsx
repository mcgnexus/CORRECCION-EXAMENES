import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Corrector de exámenes",
  description: "Revisión trazable de exámenes para docentes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
