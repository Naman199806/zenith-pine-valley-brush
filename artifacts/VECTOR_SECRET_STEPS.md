# Vector webhook secret placement

There is no secret store in this sandbox. Use a gitignored file.

## Steps

1. Open Vector in grok.com.
2. Open Routines.
3. Open apex-vector-research.
4. Copy the webhook URL and the sender key from that panel.
5. In this project, create `/workspace/.env`.
6. Put exactly two lines in it:

```
VECTOR_ROUTINE_URL=paste-url-here
VECTOR_ROUTINE_KEY=paste-key-here
```

7. Save the file. Do not commit it. `.env` is already in `.gitignore`.
8. Reply here with: saved. Do not paste the values.

Then one authenticated POST can be sent. An HTTP 200 only means the routine started. It does not mean research is complete.
