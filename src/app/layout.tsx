import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScanText — Edit Text in Screenshots",
  description:
    "Upload a screenshot, detect all text automatically, and edit it while preserving the original visual appearance. Like the screenshot itself became editable.",
  keywords: [
    "screenshot editor",
    "text editor",
    "OCR",
    "image text editing",
    "UI design tool",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script src="https://checkout.razorpay.com/v1/checkout.js" async></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
