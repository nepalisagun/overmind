import { config } from "@/config";

export function inferenceBaseUrl(apiUrl = config.apiUrl): string {
  return `${apiUrl.replace(/\/$/, "")}/api/v1`;
}

export function buildDecisionSnippets(deploymentId: string, apiUrl = config.apiUrl) {
  const base = `${apiUrl.replace(/\/$/, "")}/api`;
  const endpoint = `${base}/deployed-models/${deploymentId}/inference/`;
  const decision = {
    kind: "choice",
    options: ["No", "Yes"],
    question: "Select an option.",
    state: "Input text",
  };
  return {
    curl: [
      `curl ${endpoint} \\`,
      `  -H "Authorization: Bearer $OVERMIND_API_KEY" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${JSON.stringify({ decisions: [decision], request_key: "my-decision-001" })}'`,
      "",
      `curl ${base}/inference-requests/REQUEST_ID/ \\`,
      `  -H "Authorization: Bearer $OVERMIND_API_KEY"`,
    ].join("\n"),
    python: [
      "import os, time, uuid",
      "import requests",
      "",
      'headers = {"Authorization": "Bearer " + os.environ["OVERMIND_API_KEY"]}',
      `response = requests.post("${endpoint}", headers=headers, json={`,
      '    "request_key": str(uuid.uuid4()),',
      `    "decisions": [${JSON.stringify(decision)}],`,
      "}, timeout=30)",
      "response.raise_for_status()",
      "job = response.json()",
      'while job["status"] not in {"succeeded", "failed", "unresolved"}:',
      "    time.sleep(2)",
      `    response = requests.get(f"${base}/inference-requests/{job['id']}/", headers=headers, timeout=30)`,
      "    response.raise_for_status()",
      "    job = response.json()",
      'print(job["result"] if job["status"] == "succeeded" else job)',
    ].join("\n"),
  };
}

export function buildCurlSnippet({
  baseUrl,
  modelId,
}: {
  baseUrl: string;
  modelId: string;
}): string {
  return [
    `curl ${baseUrl}/chat/completions \\`,
    `  -H "Authorization: Bearer $OVERMIND_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "model": "${modelId}",`,
    `    "messages": [{"role": "user", "content": "Hello"}],`,
    `    "max_tokens": 256`,
    `  }'`,
  ].join("\n");
}

export function buildPythonSnippet({
  baseUrl,
  modelId,
}: {
  baseUrl: string;
  modelId: string;
}): string {
  return [
    `import os`,
    `from openai import OpenAI`,
    ``,
    `client = OpenAI(`,
    `    base_url="${baseUrl}",`,
    `    api_key=os.environ["OVERMIND_API_KEY"],`,
    `)`,
    ``,
    `resp = client.chat.completions.create(`,
    `    model="${modelId}",`,
    `    messages=[{"role": "user", "content": "Hello"}],`,
    `    max_tokens=256,`,
    `)`,
    `print(resp.choices[0].message.content)`,
  ].join("\n");
}
