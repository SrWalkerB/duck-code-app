SHELL := /bin/bash

.DEFAULT_GOAL := help

.PHONY: help install dev build lint preview rebuild db-generate db-push db-studio check

help: ## Mostra os comandos disponiveis
	@echo "Comandos disponiveis:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' Makefile | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

install: ## Instala as dependencias do projeto
	npm install

dev: ## Inicia o app em modo desenvolvimento
	npm run dev

build: ## Gera build de producao
	npm run build

lint: ## Roda o linter
	npm run lint

preview: ## Abre preview da build
	npm run preview

rebuild: ## Rebuild de modulos nativos (node-pty)
	npm run rebuild

db-generate: ## Regenera o Prisma Client
	npx prisma generate

db-push: ## Sincroniza schema Prisma com o SQLite local
	npx prisma db push

db-studio: ## Abre o Prisma Studio
	npm run db:studio

check: ## Executa validacao minima (lint + build)
	npm run lint
	npm run build
