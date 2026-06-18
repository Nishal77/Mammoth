FROM envoyproxy/envoy:v1.31-latest

COPY envoy.yaml /etc/envoy/envoy.yaml

# Non-root user for security
RUN addgroup --system envoy && adduser --system --ingroup envoy envoy
USER envoy

EXPOSE 8080 8081 9901

CMD ["envoy", "-c", "/etc/envoy/envoy.yaml"]
