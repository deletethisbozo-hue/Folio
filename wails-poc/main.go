package main

import (
	"context"
	"embed"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// This benchmark embeds the exact production React/Vite output copied from
// web/dist. No Folio UI code is rewritten for the shell comparison.
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	readyFile := os.Getenv("FOLIO_WAILS_READY_FILE")
	err := wails.Run(&options.App{
		Title:     "Folio",
		Width:     1480,
		Height:    920,
		MinWidth:  1000,
		MinHeight: 650,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnDomReady: func(_ context.Context) {
			if readyFile == "" {
				return
			}
			_ = os.WriteFile(readyFile, []byte(strconv.FormatInt(time.Now().UnixNano(), 10)), 0o600)
		},
		Windows: &windows.Options{
			Theme: windows.SystemDefault,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
