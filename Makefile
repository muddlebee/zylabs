.PHONY: dev backend frontend stop

# Start both servers in parallel (Ctrl+C stops both)
dev:
	@trap 'kill 0' INT; \
	(cd backend && uvicorn app.main:app --port 8001 --reload) & \
	(cd frontend && npm run dev) & \
	wait

backend:
	cd backend && uvicorn app.main:app --port 8001 --reload

frontend:
	cd frontend && npm run dev

stop:
	@kill $$(lsof -ti:8001,5173 2>/dev/null) 2>/dev/null && echo "Stopped" || echo "Nothing running"
