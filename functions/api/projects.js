const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// All client projects — add new ones here
const PROJECTS = {
  'jpn-mvp': {
    id: 'jpn-mvp',
    name: 'Jesus People Network MVP',
    client: 'Craig',
    code: 'JPN2026',
  },
};

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  const project = Object.values(PROJECTS).find(p => p.code === code?.toUpperCase());
  if (!project) return json({ error: 'Invalid project code' }, 404);

  return json({ id: project.id, name: project.name, client: project.client, code: project.code });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
