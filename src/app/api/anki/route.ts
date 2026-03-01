import { NextRequest, NextResponse } from "next/server";

const ANKI_URL = "http://localhost:8765";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(ANKI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { result: null, error: "Could not connect to AnkiConnect. Is Anki running?" },
      { status: 502 }
    );
  }
}
