"""Exercise installed App Server continuation against a local mock; no real inference.

Run explicitly: python3 apps/android/test/composer-continuation.protocol.test.py
Uses an isolated temporary CODEX_HOME; never attaches to the running daemon.
"""
import json, os, queue, subprocess, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

requests=[]
mode='complete'
entered=threading.Event()
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(b'{"data":[]}')
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if not self.path.endswith('/responses'):
            self.send_response(200); self.end_headers(); self.wfile.write(b'{}'); return
        requests.append(body); entered.set()
        if mode=='fail':
            self.send_response(400); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(b'{"error":{"message":"Fixture failure","type":"invalid_request_error","code":"invalid_request"}}'); return
        self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
        def event(value):
            self.wfile.write(('data: '+json.dumps(value)+'\n\n').encode()); self.wfile.flush()
        try:
            event({'type':'response.created','response':{'id':'fixture_response'}})
            if mode=='hold':
                time.sleep(15); return
            item={'id':'fixture_message','type':'message','role':'assistant','status':'completed','phase':'final_answer','content':[{'type':'output_text','text':'Fixture complete','annotations':[]}]}
            event({'type':'response.output_item.added','output_index':0,'item':item})
            event({'type':'response.output_item.done','output_index':0,'item':item})
            event({'type':'response.completed','response':{'id':'fixture_response','status':'completed','output':[item],'usage':{'input_tokens':10,'output_tokens':2,'total_tokens':12}}})
        except (BrokenPipeError,ConnectionResetError): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory(prefix='codewide-composer-protocol-') as home:
    Path(home,'config.toml').write_text(f'''model = "mock-model"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "read-only"
[features]
goals = true
[model_providers.fixture]
name = "Local fixture"
base_url = "http://127.0.0.1:{server.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
''')
    env=dict(os.environ,CODEX_HOME=home)
    # This subprocess uses an isolated home and a localhost mock provider. It never
    # connects to the running daemon or a real inference service.
    with open(Path(home, 'app-server.stderr'), 'w') as err:
        proc=subprocess.Popen(['codex','app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,env=env,cwd=home)
        output=queue.Queue(); pending=[]; seq=0
        def reader():
            for line in proc.stdout:
                try: output.put(json.loads(line))
                except json.JSONDecodeError: pass
        threading.Thread(target=reader,daemon=True).start()
        def send(value): proc.stdin.write(json.dumps(value)+'\n'); proc.stdin.flush()
        def wait(predicate,timeout=25):
            deadline=time.monotonic()+timeout
            for i,item in enumerate(pending):
                if predicate(item): return pending.pop(i)
            while time.monotonic()<deadline:
                item=output.get(timeout=max(.01,deadline-time.monotonic()))
                if predicate(item): return item
                pending.append(item)
            raise TimeoutError('App Server fixture notification timed out')
        def rpc(method,params):
            global seq
            seq+=1; send({'id':seq,'method':method,'params':params}); value=wait(lambda v:v.get('id')==seq)
            if 'error' in value: raise RuntimeError(f'{method}: {value["error"]}')
            return value['result']
        def completed(turn_id=None):
            return wait(lambda v:v.get('method')=='turn/completed' and (turn_id is None or v['params']['turn']['id']==turn_id))['params']['turn']
        try:
            rpc('initialize',{'clientInfo':{'name':'codewide_local_fixture','version':'1'},'capabilities':{'experimentalApi':True}})
            send({'method':'initialized'})
            thread=rpc('thread/start',{'model':'mock-model','modelProvider':'fixture','cwd':home,'approvalPolicy':'never','sandbox':'read-only'})['thread']['id']
            mode='hold'; entered.clear()
            initial=rpc('turn/start',{'threadId':thread,'input':[{'type':'text','text':'Fixture user context'}]})['turn']['id']
            assert entered.wait(15), 'No model request for initial turn'
            rpc('turn/interrupt',{'threadId':thread,'turnId':initial})
            assert completed(initial)['status']=='interrupted'
            mode='complete'
            continued=rpc('turn/start',{'threadId':thread,'input':[]})['turn']['id']
            result=completed(continued)
            assert result['status']=='completed', result
            assert not any(i['type']=='userMessage' for i in result['items']), result
            print('PASS installed CLI: interrupted -> empty turn/start -> completed; no userMessage')
            mode='fail'
            failed=rpc('turn/start',{'threadId':thread,'input':[]})['turn']['id']
            assert completed(failed)['status']=='failed'
            mode='complete'
            retried=rpc('turn/start',{'threadId':thread,'input':[]})['turn']['id']
            result=completed(retried)
            assert result['status']=='completed'
            assert not any(i['type']=='userMessage' for i in result['items'])
            print('PASS installed CLI: failed -> empty turn/start -> completed; no userMessage')
            paused=rpc('thread/goal/set',{'threadId':thread,'objective':'Finish the local fixture','status':'paused'})['goal']
            before=len(requests)
            active=rpc('thread/goal/set',{'threadId':thread,'status':'active'})['goal']
            result=completed()
            assert result['status']=='completed'
            assert len(requests)>before
            assert not any(i['type']=='userMessage' for i in result['items'])
            rpc('thread/goal/set',{'threadId':thread,'status':'paused'})
            print('PASS installed CLI: paused goal -> goal/set active -> automatic turn; no userMessage')
            assert paused['objective']==active['objective'] and paused['tokensUsed']==active['tokensUsed']
            history=rpc('thread/turns/list',{'threadId':thread,'limit':16,'sortDirection':'desc','itemsView':'full'})
            users=[item for turn in history['data'] for item in turn['items'] if item['type']=='userMessage']
            assert len(users)==1, 'A continuation synthesized a persisted user message'
            print('PASS persisted history retains exactly the original fixture userMessage')
        finally:
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()
server.shutdown()
