BINARY = ../bin/nowplaying-helper
SRC = nowplaying-helper.swift

.PHONY: build clean

build: $(BINARY)

$(BINARY): $(SRC)
	@mkdir -p ../bin
	swiftc -O -o $(BINARY) $(SRC) -framework Foundation

clean:
	rm -f $(BINARY)
