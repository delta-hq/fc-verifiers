import modal

stub = modal.Stub()

@stub.function()
def hello():
    return "Hello from Modal!"

@stub.local_entrypoint()
def main():
    print(hello.remote())