.PHONY: dev backend frontend stop

DEV_PORTS := 8001 5173

# Kill processes listening on dev ports (Linux + macOS)
define kill_dev_ports
	for port in $(DEV_PORTS); do \
		pids=$$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null); \
		if [ -n "$$pids" ]; then \
			echo "Stopping port $$port (PIDs: $$pids)..."; \
			kill -TERM $$pids 2>/dev/null || true; \
		fi; \
	done; \
	sleep 0.3; \
	for port in $(DEV_PORTS); do \
		pids=$$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null); \
		if [ -n "$$pids" ]; then \
			kill -KILL $$pids 2>/dev/null || true; \
		fi; \
	done
endef

# Start both servers in parallel (Ctrl+C stops both and frees ports)
dev:
	@$(MAKE) --no-print-directory stop >/dev/null 2>&1 || true; \
	cleanup() { \
		kill 0 2>/dev/null || true; \
		$(kill_dev_ports); \
	}; \
	trap cleanup EXIT INT TERM; \
	(cd backend && uvicorn app.main:app --port 8001 --reload) & \
	(cd frontend && npm run dev) & \
	wait

backend:
	cd backend && uvicorn app.main:app --port 8001 --reload

frontend:
	cd frontend && npm run dev

stop:
	@stopped=0; \
	for port in $(DEV_PORTS); do \
		if lsof -tiTCP:$$port -sTCP:LISTEN >/dev/null 2>&1; then stopped=1; fi; \
	done; \
	$(kill_dev_ports); \
	if [ $$stopped -eq 1 ]; then echo "Stopped"; else echo "Nothing running"; fi
