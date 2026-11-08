FROM golang:1.24-alpine AS build
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/main.go ./
RUN CGO_ENABLED=0 go build -o /tnt .

FROM alpine AS certs
RUN apk add --no-cache ca-certificates

FROM scratch
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /tnt /tnt
COPY dist /srv/dist
ENV STATIC_ROOT=/srv/dist TNT_DB=/srv/data/tnt.db PORT=8420
EXPOSE 8420
CMD ["/tnt"]
