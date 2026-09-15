export const pythonStreamTemplate = `# pip install trueforge-sdk
from trueforge_sdk import TrueForge
from trueforge_sdk.events import is_event_delta, merge_event_delta

client = TrueForge(
    base_url={{baseUrl}},{{tokenLine}}
)

session = client.sessions.create(
    agent={"name": {{agentName}}},
)

events = {}

stream = client.sessions.create_turn_stream(
    session_id=session.data.id,
    input=[{"type": "user.message", "content": "Hello!"}],
)

for event in stream:
    print(event)
    if is_event_delta(event):
        base = events.get(event.id)
        if base is not None:
            merge_event_delta(base, event)
    else:
        events[event.id] = event
`;

export const pythonNonStreamTemplate = `# pip install trueforge-sdk
from trueforge_sdk import TrueForge

client = TrueForge(
    base_url={{baseUrl}},{{tokenLine}}
)

session = client.sessions.create(
    agent={"name": {{agentName}}},
)

turn = client.sessions.create_turn(
    session_id=session.data.id,
    input=[{"type": "user.message", "content": "Hello!"}],
)

print(turn.data.id, turn.data.state)

# Call get_turn to check turn state.
latest = client.sessions.get_turn(session_id=session.data.id, turn_id=turn.data.id)
print(latest.data.state)
`;
